package market

import (
	"context"
	"time"
)

const (
	// newsTTL keeps a symbol's headlines for half an hour, so Stock Detail costs
	// about one vendor call per symbol every 30 minutes however often it is opened.
	newsTTL = 30 * time.Minute
	// newsWindow is how far back the news is searched.
	newsWindow = 7 * 24 * time.Hour
	// newsLimit is how many articles a symbol's news lists.
	newsLimit = 10
)

// NewsArticle is one news story about a company, as the vendor published it:
// Finnhub's headlines and summaries are in English.
type NewsArticle struct {
	Headline string `json:"headline"`
	// Summary is the vendor's teaser, shortened to a few lines; empty when the
	// vendor has none.
	Summary string `json:"summary"`
	// Source is the publisher as the vendor names it (e.g. "Yahoo", "Benzinga").
	Source string `json:"source"`
	// URL is an https link to the article, possibly through the vendor's redirect.
	URL         string    `json:"url"`
	PublishedAt time.Time `json:"publishedAt"`
}

// NewsProvider is implemented by vendors that publish company news.
type NewsProvider interface {
	// CompanyNews returns up to limit articles about symbol published between
	// from and to (US market dates, both included), newest first. Articles
	// without an https link are left out.
	CompanyNews(ctx context.Context, symbol Symbol, from, to time.Time, limit int) ([]NewsArticle, error)
}

// NewsResult is a symbol's latest news, newest first.
type NewsResult struct {
	Symbol    Symbol        `json:"symbol"`
	Articles  []NewsArticle `json:"articles"`
	Freshness Freshness     `json:"freshness"`
}

// News returns the latest articles about symbol from the past week. It fails
// with ErrNotConfigured when no configured vendor publishes company news.
func (s *Service) News(ctx context.Context, symbol Symbol) (NewsResult, error) {
	np, ok := s.source(KindNews).(NewsProvider)
	if !ok {
		return NewsResult{}, ErrNotConfigured
	}
	e, stale, err := load(ctx, s, s.news, "news:"+string(symbol), fixedTTL[[]NewsArticle](newsTTL),
		func(fctx context.Context) ([]NewsArticle, error) {
			now := s.cfg.Now()
			return np.CompanyNews(fctx, symbol, now.Add(-newsWindow), now, newsLimit)
		})
	if err != nil {
		return NewsResult{}, err
	}
	return NewsResult{
		Symbol: symbol, Articles: nonNil(e.Value), Freshness: s.freshness(KindNews, nil, e.StoredAt, stale),
	}, nil
}
