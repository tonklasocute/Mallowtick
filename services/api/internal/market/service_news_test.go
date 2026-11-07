package market

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// newsFake is a quote vendor that, like Finnhub, publishes company news.
type newsFake struct {
	namedFake
	calls atomic.Int32

	mu       sync.Mutex
	err      error
	articles []NewsArticle
	from, to time.Time
	limit    int
}

func (n *newsFake) CompanyNews(_ context.Context, _ Symbol, from, to time.Time, limit int) ([]NewsArticle, error) {
	n.calls.Add(1)
	n.mu.Lock()
	defer n.mu.Unlock()
	n.from, n.to, n.limit = from, to, limit
	if n.err != nil {
		return nil, n.err
	}
	return n.articles, nil
}

func (n *newsFake) setErr(err error) {
	n.mu.Lock()
	n.err = err
	n.mu.Unlock()
}

func newsVendor(articles ...NewsArticle) *newsFake {
	return &newsFake{namedFake: namedFake{&fakeProvider{}, "finnhub"}, articles: articles}
}

var rklbArticle = NewsArticle{
	Headline: "Rocket Lab Stock Pulls Out of a Nosedive Friday: What's Going On?", Source: "Benzinga",
	URL: "https://finnhub.io/api/news?id=43a8", PublishedAt: time.Date(2026, 11, 6, 8, 50, 38, 0, time.UTC),
}

func TestNewsComesFromTheQuoteVendorAndIsCached(t *testing.T) {
	clk := &testClock{t: time.Date(2026, 11, 7, 3, 0, 0, 0, time.UTC)}
	quotes := newsVendor(rklbArticle)
	s := newTestService(Composite{QuoteSource: quotes, BarSource: namedFake{&fakeProvider{}, "twelvedata"}}, clk)
	ctx := context.Background()

	for range 2 {
		r, err := s.News(ctx, "RKLB")
		if err != nil || r.Symbol != "RKLB" || len(r.Articles) != 1 || r.Articles[0] != rklbArticle {
			t.Fatalf("unexpected result %+v %v", r, err)
		}
		if r.Freshness.Provider != "finnhub" || r.Freshness.Stale || !r.Freshness.FetchedAt.Equal(clk.now()) {
			t.Fatalf("freshness should name the news vendor: %+v", r.Freshness)
		}
	}
	if quotes.calls.Load() != 1 {
		t.Fatalf("news should be cached; calls = %d", quotes.calls.Load())
	}
	if !quotes.to.Equal(clk.now()) || !quotes.from.Equal(clk.now().Add(-7*24*time.Hour)) || quotes.limit != 10 {
		t.Fatalf("should ask for the last week's 10 newest: from %v to %v limit %d", quotes.from, quotes.to, quotes.limit)
	}
	if info := s.ProviderInfo(); info.Sources[KindNews].Name != "finnhub" {
		t.Fatalf("health should name the news vendor: %+v", info.Sources)
	}

	clk.advance(29 * time.Minute)
	_, _ = s.News(ctx, "RKLB")
	if quotes.calls.Load() != 1 {
		t.Fatalf("news should be kept for 30 minutes; calls = %d", quotes.calls.Load())
	}
	clk.advance(2 * time.Minute)
	if _, err := s.News(ctx, "RKLB"); err != nil || quotes.calls.Load() != 2 {
		t.Fatalf("expired news should be refetched; calls = %d, err = %v", quotes.calls.Load(), err)
	}
}

func TestNewsFallsBackToStaleArticles(t *testing.T) {
	clk := &testClock{t: time.Date(2026, 11, 7, 3, 0, 0, 0, time.UTC)}
	quotes := newsVendor(rklbArticle)
	s := newTestService(Composite{QuoteSource: quotes, BarSource: &fakeProvider{}}, clk)
	ctx := context.Background()
	first, err := s.News(ctx, "RKLB")
	if err != nil {
		t.Fatal(err)
	}

	clk.advance(newsTTL + time.Minute)
	quotes.setErr(ErrRateLimited)
	r, err := s.News(ctx, "RKLB")
	if err != nil || len(r.Articles) != 1 || !r.Freshness.Stale || !r.Freshness.FetchedAt.Equal(first.Freshness.FetchedAt) {
		t.Fatalf("a failed refresh should serve the cached articles marked stale: %+v %v", r, err)
	}
	if _, err := s.News(ctx, "AAPL"); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("nothing cached: got %v, want the vendor's error", err)
	}
}

func TestNoNewsIsAnEmptyList(t *testing.T) {
	s := newTestService(Composite{QuoteSource: newsVendor(), BarSource: &fakeProvider{}}, &testClock{t: time.Unix(0, 0)})
	r, err := s.News(context.Background(), "SPY")
	if err != nil || r.Articles == nil || len(r.Articles) != 0 {
		t.Fatalf("no articles should be [], not null: %+v %v", r, err)
	}
}

func TestNewsNeedsANewsVendor(t *testing.T) {
	for name, p := range map[string]Provider{
		"single vendor":             &fakeProvider{},
		"composite without news":    Composite{QuoteSource: namedFake{&fakeProvider{}, "finnhub"}, BarSource: &fakeProvider{}},
		"composite, quotes missing": Composite{QuoteSource: Unconfigured{ProviderName: "finnhub"}, BarSource: &fakeProvider{}},
	} {
		t.Run(name, func(t *testing.T) {
			s := newTestService(p, &testClock{t: time.Unix(0, 0)})
			if _, err := s.News(context.Background(), "AAPL"); !errors.Is(err, ErrNotConfigured) {
				t.Fatalf("got %v, want ErrNotConfigured", err)
			}
			if _, ok := s.ProviderInfo().Sources[KindNews]; ok {
				t.Fatal("a deployment without a news vendor should not list one")
			}
		})
	}
}

func TestCompositeForwardsNewsOnlyToAConfiguredVendor(t *testing.T) {
	ctx := context.Background()
	now := time.Unix(0, 0)
	got, err := Composite{QuoteSource: newsVendor(rklbArticle), BarSource: &fakeProvider{}}.CompanyNews(ctx, "RKLB", now, now, 10)
	if err != nil || len(got) != 1 {
		t.Fatalf("got %+v %v", got, err)
	}
	if _, err := (Composite{QuoteSource: &fakeProvider{}, BarSource: newsVendor()}).CompanyNews(ctx, "RKLB", now, now, 10); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("news must come from the quote vendor only, got %v", err)
	}
}
