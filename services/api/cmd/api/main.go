// Command api serves the Mallowtick market-data API.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
	_ "time/tzdata" // exchange time zones must resolve even without system tzdata

	"github.com/gin-gonic/gin"

	"github.com/tonklasocute/mallowtick/services/api/internal/clientlimit"
	"github.com/tonklasocute/mallowtick/services/api/internal/config"
	"github.com/tonklasocute/mallowtick/services/api/internal/market"
	"github.com/tonklasocute/mallowtick/services/api/internal/market/finnhub"
	"github.com/tonklasocute/mallowtick/services/api/internal/market/twelvedata"
	"github.com/tonklasocute/mallowtick/services/api/internal/supportresistance"
	httptransport "github.com/tonklasocute/mallowtick/services/api/internal/transport/http"
)

// cacheSaveInterval is how often the market cache is saved, so a crash loses
// at most this much of what was fetched.
const cacheSaveInterval = 5 * time.Minute

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load(os.LookupEnv)
	if err != nil {
		return err
	}
	log := newLogger(cfg)
	if cfg.Env != "development" {
		gin.SetMode(gin.ReleaseMode)
	}

	provider, err := newProvider(cfg, log)
	if err != nil {
		return err
	}
	svc := market.NewService(provider, market.ServiceConfig{
		Latency:         cfg.Market.Latency,
		QuoteTTL:        cfg.Market.QuoteTTL,
		QuoteTTLClosed:  cfg.Market.QuoteTTLClosed,
		StaleRetention:  cfg.Market.StaleRetention,
		ProviderTimeout: cfg.TwelveData.Timeout + cfg.TwelveData.MaxWait,
		OverviewSymbols: cfg.Market.OverviewSymbols,
		PopularSymbols:  cfg.Market.PopularSymbols,
		Levels:          supportresistance.DefaultConfig(),
		Logger:          log,
	})

	// The file holds Twelve Data's bars, status and rate only. Without its key
	// they would be served in place of provider_not_configured, so skip it.
	cacheFile := cfg.Market.CacheFile
	if !cfg.ProviderConfigured() {
		cacheFile = ""
	}
	if cacheFile != "" {
		// Before the warm-up, so a restored status that is still fresh saves it.
		loadCache(svc, cacheFile, log)
	}

	if cfg.ProviderConfigured() {
		// Spend the market-status credit before any client arrives, so the first
		// Discover load (overview batch + one sparkline) fits the per-minute budget.
		go func() {
			if _, err := svc.MarketStatus(context.Background()); err != nil {
				log.Warn("market status warm-up failed", slog.Any("error", err))
			}
		}()
	}

	srv := &http.Server{
		Addr: cfg.Addr,
		Handler: httptransport.NewRouter(httptransport.Options{
			Service: svc, Logger: log, CORSOrigins: cfg.CORSOrigins, RequestTimeout: cfg.RequestTimeout,
			Limiter: newClientLimiter(cfg.Clients), TrustedProxies: cfg.Clients.TrustedProxies,
		}),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      cfg.RequestTimeout + 5*time.Second,
		IdleTimeout:       60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	saveFinal := func() {}
	if cacheFile != "" {
		saveFinal = keepCacheSaved(ctx, svc, cacheFile, log)
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("api listening", slog.String("addr", cfg.Addr), slog.String("env", cfg.Env),
			slog.String("provider", provider.Name()), slog.Bool("provider_configured", provider.Configured()),
			slog.String("latency", string(cfg.Market.Latency)))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case err := <-errCh:
		return fmt.Errorf("server: %w", err)
	case <-ctx.Done():
	}

	log.Info("shutting down", slog.Duration("timeout", cfg.ShutdownTimeout))
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	shutdownErr := srv.Shutdown(shutdownCtx)
	saveFinal() // after Shutdown, so it keeps what the last requests fetched
	if shutdownErr != nil {
		return fmt.Errorf("shutdown: %w", shutdownErr)
	}
	return nil
}

// loadCache restores the market cache an earlier run saved. A missing file is
// normal on the first start; a broken one is ignored and replaced at the next save.
func loadCache(svc *market.Service, path string, log *slog.Logger) {
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		log.Info("no market cache file yet", slog.String("path", path))
		return
	}
	if err != nil {
		log.Warn("market cache not loaded", slog.String("path", path), slog.Any("error", err))
		return
	}
	defer func() { _ = f.Close() }()
	if err := svc.LoadCache(f); err != nil {
		log.Warn("market cache not loaded", slog.String("path", path), slog.Any("error", err))
	}
}

// keepCacheSaved saves the market cache every cacheSaveInterval until ctx is
// done. The returned func waits for that loop to stop and saves once more.
func keepCacheSaved(ctx context.Context, svc *market.Service, path string, log *slog.Logger) func() {
	done := make(chan struct{})
	go func() {
		defer close(done)
		tick := time.NewTicker(cacheSaveInterval)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
				saveCache(svc, path, log)
			}
		}
	}()
	return func() {
		<-done
		saveCache(svc, path, log)
	}
}

func saveCache(svc *market.Service, path string, log *slog.Logger) {
	if err := writeCacheFile(svc, path); err != nil {
		log.Warn("market cache not saved", slog.String("path", path), slog.Any("error", err))
		return
	}
	log.Debug("market cache saved", slog.String("path", path))
}

// writeCacheFile writes to a temporary file in the same directory and renames
// it over path, so a crash mid-write never leaves a truncated cache file.
func writeCacheFile(svc *market.Service, path string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(tmp.Name()) }() // fails harmlessly once renamed
	if err := svc.SaveCache(tmp); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

// newClientLimiter gives each client its limits, so one cannot spend the
// shared provider budgets for everyone.
func newClientLimiter(cfg config.Clients) *clientlimit.Limiter {
	return clientlimit.New(clientlimit.Config{
		RequestsPerMinute: cfg.RequestsPerMinute,
		Vendors: map[string]clientlimit.Rate{
			twelvedata.ProviderName: {PerDay: cfg.TwelveDataPerDay},
			finnhub.ProviderName:    {PerMinute: cfg.FinnhubPerMinute},
		},
	})
}

func newLogger(cfg config.Config) *slog.Logger {
	opts := &slog.HandlerOptions{Level: cfg.LogLevel}
	if cfg.LogFormat == "text" {
		return slog.New(slog.NewTextHandler(os.Stdout, opts))
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, opts))
}

// newProvider returns Twelve Data alone, or, with a Finnhub key, Finnhub for
// quotes, search, earnings and fundamentals combined with Twelve Data for
// candles and market status.
func newProvider(cfg config.Config, log *slog.Logger) (market.Provider, error) {
	var bars market.Provider = market.Unconfigured{ProviderName: twelvedata.ProviderName}
	if cfg.ProviderConfigured() {
		td, err := twelvedata.New(twelvedata.Config{
			APIKey:           cfg.TwelveData.APIKey,
			BaseURL:          cfg.TwelveData.BaseURL,
			CreditsPerMinute: cfg.TwelveData.CreditsPerMinute,
			MaxWait:          cfg.TwelveData.MaxWait,
			HTTPClient:       &http.Client{Timeout: cfg.TwelveData.Timeout},
			Logger:           log,
		})
		if err != nil {
			return nil, err
		}
		bars = td
	} else {
		log.Warn("TWELVEDATA_API_KEY is not set; candles and market status will report provider_not_configured")
	}
	if cfg.Finnhub.APIKey == "" {
		return bars, nil
	}
	fh, err := finnhub.New(finnhub.Config{
		APIKey:         cfg.Finnhub.APIKey,
		BaseURL:        cfg.Finnhub.BaseURL,
		CallsPerMinute: cfg.Finnhub.CallsPerMinute,
		MaxWait:        cfg.Finnhub.MaxWait,
		HTTPClient:     &http.Client{Timeout: cfg.Finnhub.Timeout},
		Logger:         log,
	})
	if err != nil {
		return nil, err
	}
	return market.Composite{QuoteSource: fh, BarSource: bars}, nil
}
