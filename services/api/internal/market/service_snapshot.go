package market

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"time"

	"github.com/tonklasocute/mallowtick/services/api/internal/cache"
)

// cacheSnapshotVersion changes whenever a saved cache's keys or value type
// change meaning, so a file from an older build is ignored instead of misread.
const cacheSnapshotVersion = 1

// cacheSnapshot is the file SaveCache writes. It holds only the caches that
// cost Twelve Data credits; the others refill from Finnhub's larger budget.
type cacheSnapshot struct {
	Version int                        `json:"version"`
	SavedAt time.Time                  `json:"savedAt"`
	Candles []cache.Item[CandleSeries] `json:"candles"`
	Status  []cache.Item[MarketStatus] `json:"status"`
	FX      []cache.Item[ExchangeRate] `json:"fx"`
}

// SaveCache writes the candle, market-status and exchange-rate caches as
// versioned JSON for LoadCache, so a restart does not refetch them.
func (s *Service) SaveCache(w io.Writer) error {
	return json.NewEncoder(w).Encode(cacheSnapshot{
		Version: cacheSnapshotVersion,
		SavedAt: s.cfg.Now().UTC(),
		Candles: s.candles.Snapshot(),
		Status:  s.status.Snapshot(),
		FX:      s.fx.Snapshot(),
	})
}

// LoadCache restores what SaveCache wrote. Entries keep their fetch and expiry
// times, so each is fresh, stale or dropped as if the API had kept running.
// Nothing is restored from a file it cannot read or of another version.
func (s *Service) LoadCache(r io.Reader) error {
	var snap cacheSnapshot
	if err := json.NewDecoder(r).Decode(&snap); err != nil {
		return fmt.Errorf("read cache snapshot: %w", err)
	}
	if snap.Version != cacheSnapshotVersion {
		return fmt.Errorf("cache snapshot version %d, want %d", snap.Version, cacheSnapshotVersion)
	}
	candles := s.candles.Restore(snap.Candles)
	status := s.status.Restore(snap.Status)
	fx := s.fx.Restore(snap.FX)
	s.log.Info("restored market cache", slog.Time("saved_at", snap.SavedAt),
		slog.Int("candles", candles), slog.Int("status", status), slog.Int("fx", fx))
	return nil
}
