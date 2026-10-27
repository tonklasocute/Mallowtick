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
	"syscall"
	"time"
	_ "time/tzdata" // exchange time zones must resolve even without system tzdata

	"github.com/gin-gonic/gin"

	"github.com/tonklasocute/mallowtick/services/api/internal/config"
	"github.com/tonklasocute/mallowtick/services/api/internal/market"
	"github.com/tonklasocute/mallowtick/services/api/internal/market/finnhub"
	"github.com/tonklasocute/mallowtick/services/api/internal/market/twelvedata"
	"github.com/tonklasocute/mallowtick/services/api/internal/supportresistance"
	httptransport "github.com/tonklasocute/mallowtick/services/api/internal/transport/http"
)

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
		}),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      cfg.RequestTimeout + 5*time.Second,
		IdleTimeout:       60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

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
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	return nil
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
