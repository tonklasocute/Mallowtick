package market

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// newsFake is a quote vendor that publishes news.
type newsFake struct {
	namedFake
	mu      sync.Mutex
	market  []NewsArticle
	company map[Symbol][]NewsArticle
	asked   []Symbol
	calls   atomic.Int32
	err     error
}

func newNewsFake() *newsFake {
	return &newsFake{namedFake: namedFake{&fakeProvider{}, "finnhub"}, company: map[Symbol][]NewsArticle{}}
}

func (f *newsFake) MarketNews(context.Context, string) ([]NewsArticle, error) {
	f.calls.Add(1)
	return f.market, f.err
}

func (f *newsFake) CompanyNews(_ context.Context, sym Symbol, _, _ string) ([]NewsArticle, error) {
	f.calls.Add(1)
	f.mu.Lock()
	f.asked = append(f.asked, sym)
	f.mu.Unlock()
	if f.err != nil {
		return nil, f.err
	}
	return f.company[sym], nil
}

func article(id, headline, source, url string, at time.Time, related ...string) NewsArticle {
	return NewsArticle{ID: id, Headline: headline, Source: source, URL: url, PublishedAt: at, Category: "company",
		Related: related, Provider: "finnhub"}
}

var newsT0 = time.Date(2026, 11, 17, 15, 0, 0, 0, time.UTC)

func TestGroupNewsMergesDuplicatesAndKeepsEveryPublisher(t *testing.T) {
	long := "Apple's supplier said quarterly demand for its components rose sharply on new iPhone orders and AI servers."
	in := []NewsArticle{
		// Same vendor article returned for two symbols' queries.
		article("fh-1", "Apple supplier raises outlook on iPhone demand", "Yahoo", "https://finnhub.io/api/news?id=a", newsT0, "AAPL"),
		article("fh-1", "Apple supplier raises outlook on iPhone demand", "Yahoo", "https://finnhub.io/api/news?id=a", newsT0, "TSM"),
		// Same story, another publisher, a publisher suffix and later.
		article("fh-2", "Apple Supplier Raises Outlook on iPhone Demand - Reuters", "Reuters", "https://reuters.com/x", newsT0.Add(time.Hour), "AAPL"),
		// Same page behind tracking parameters.
		article("fh-3", "Totally different headline here today", "CNBC", "https://www.cnbc.com/story/?utm_source=x&b=2&a=1#top", newsT0.Add(2*time.Hour)),
		article("fh-4", "Another different headline for the page", "CNBC", "https://cnbc.com/story?a=1&b=2", newsT0.Add(3*time.Hour)),
		// Identical long summary under another headline: same content.
		{ID: "fh-5", Headline: "Shares of suppliers jump", Summary: long, Source: "Benzinga", URL: "https://b.com/1", PublishedAt: newsT0.Add(4 * time.Hour)},
		{ID: "fh-6", Headline: "Component makers rally", Summary: long, Source: "MarketWatch", URL: "https://m.com/2", PublishedAt: newsT0.Add(5 * time.Hour)},
		// A short, generic headline is never grouped by its text.
		article("fh-7", "Stocks to watch", "Yahoo", "https://y.com/1", newsT0),
		article("fh-8", "Stocks to watch", "Benzinga", "https://bz.com/1", newsT0),
		// Same headline days apart is a new story.
		article("fh-9", "Apple supplier raises outlook on iPhone demand", "Yahoo", "https://y.com/later", newsT0.Add(72*time.Hour)),
	}
	got := GroupNews(in)
	ids := make([]string, len(got))
	for i, g := range got {
		ids[i] = g.ID
	}
	if want := []string{"fh-9", "fh-5", "fh-3", "fh-1", "fh-7", "fh-8"}; !slices.Equal(ids, want) {
		t.Fatalf("groups = %v, want %v (newest first)", ids, want)
	}
	byID := map[string]NewsArticle{}
	for _, g := range got {
		byID[g.ID] = g
	}
	apple := byID["fh-1"]
	if !slices.Equal(apple.Related, []string{"AAPL", "TSM"}) || len(apple.Sources) != 2 ||
		apple.Sources[0].Source != "Yahoo" || apple.Sources[1].Source != "Reuters" || apple.Sources[1].URL != "https://reuters.com/x" {
		t.Fatalf("apple story = %+v", apple)
	}
	if len(byID["fh-3"].Sources) != 2 || len(byID["fh-5"].Sources) != 2 {
		t.Fatalf("URL or content duplicates not grouped: %+v %+v", byID["fh-3"].Sources, byID["fh-5"].Sources)
	}
	if in[0].Related[0] != "AAPL" || len(in[0].Related) != 1 {
		t.Fatal("GroupNews must not change its input")
	}
}

func TestNormalizeURL(t *testing.T) {
	for raw, want := range map[string]string{
		"https://WWW.Example.com/a/b/?utm_medium=x&z=1&a=2#frag": "https://example.com/a/b?a=2&z=1",
		"http://example.com/":    "https://example.com",
		"javascript:alert(1)":    "",
		"/relative/path":         "",
		"ftp://example.com/file": "",
	} {
		if got := NormalizeURL(raw); got != want {
			t.Errorf("NormalizeURL(%q) = %q, want %q", raw, got, want)
		}
	}
}

func newsService(f *newsFake, clk *testClock) *Service {
	return newTestService(Composite{QuoteSource: f, BarSource: &fakeProvider{}}, clk)
}

func TestCompanyNewsFetchesAFewSymbolsPerRequest(t *testing.T) {
	f := newNewsFake()
	syms := []Symbol{"A", "B", "C", "D", "E", "F", "G"}
	for i, s := range syms {
		f.company[s] = []NewsArticle{article(fmt.Sprintf("fh-%d", i+1), "Headline about "+string(s), "Yahoo",
			fmt.Sprintf("https://y.com/%d", i), newsT0.Add(time.Duration(i)*time.Minute), string(s))}
	}
	clk := nyClock()
	s := newsService(f, clk)
	ctx := context.Background()

	res, err := s.News(ctx, NewsQuery{Symbols: syms})
	if err != nil {
		t.Fatal(err)
	}
	if f.calls.Load() != newsFetches || res.Total != newsFetches || len(res.Unavailable) != len(syms)-newsFetches {
		t.Fatalf("calls %d, total %d, unavailable %+v", f.calls.Load(), res.Total, res.Unavailable)
	}
	if res.Unavailable[0].Reason != "rate_limited" {
		t.Fatalf("symbols left for later are rate_limited, got %+v", res.Unavailable)
	}
	// The next request fetches the rest and reuses the cache for the first five.
	res, err = s.News(ctx, NewsQuery{Symbols: syms})
	if err != nil || res.Total != len(syms) || len(res.Unavailable) != 0 || f.calls.Load() != int32(len(syms)) {
		t.Fatalf("second request: total %d, unavailable %+v, calls %d, err %v", res.Total, res.Unavailable, f.calls.Load(), err)
	}
	if res.Articles[0].ID != "fh-7" || res.Freshness.Provider != "finnhub" || res.Freshness.AsOf == nil {
		t.Fatalf("newest first with freshness: %+v %+v", res.Articles[0], res.Freshness)
	}
}

func TestNewsPagesAndDateFilters(t *testing.T) {
	f := newNewsFake()
	for i := range 25 {
		f.market = append(f.market, article(fmt.Sprintf("fh-%d", i+1), fmt.Sprintf("Market headline number %d today", i),
			"Reuters", fmt.Sprintf("https://r.com/%d", i), newsT0.Add(-time.Duration(i)*6*time.Hour)))
	}
	s := newsService(f, nyClock())
	ctx := context.Background()
	res, err := s.News(ctx, NewsQuery{Limit: 10, Page: 3})
	if err != nil || len(res.Articles) != 5 || res.Total != 25 || res.HasMore || res.Page != 3 {
		t.Fatalf("page 3 = %d articles, total %d, more %v, err %v", len(res.Articles), res.Total, res.HasMore, err)
	}
	// newsT0 is 10 AM on the 17th in New York; 6-hour steps reach back about six days.
	res, err = s.News(ctx, NewsQuery{From: "2026-11-16", To: "2026-11-16", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range res.Articles {
		if d := a.PublishedAt.In(newYorkLocation()).Format(time.DateOnly); d != "2026-11-16" {
			t.Fatalf("article from %s outside the filter", d)
		}
	}
	if res.Total != 4 || f.calls.Load() != 1 {
		t.Fatalf("filtered total %d (want 4), calls %d (want 1: cached)", res.Total, f.calls.Load())
	}
}

func TestArticleIsFoundOnlyAfterBeingServed(t *testing.T) {
	f := newNewsFake()
	f.market = []NewsArticle{article("fh-42", "A market headline worth reading now", "Reuters", "https://r.com/42", newsT0)}
	s := newsService(f, nyClock())
	ctx := context.Background()
	if _, err := s.Article(ctx, "fh-42"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("got %v before listing, want ErrNotFound", err)
	}
	if _, err := s.News(ctx, NewsQuery{}); err != nil {
		t.Fatal(err)
	}
	a, err := s.Article(ctx, "fh-42")
	if err != nil || a.Headline != "A market headline worth reading now" || len(a.Sources) != 1 {
		t.Fatalf("article = %+v %v", a, err)
	}
}

func TestNewsFailsWithoutAVendorOrWhenAllSymbolsFail(t *testing.T) {
	s := newTestService(&fakeProvider{}, nyClock())
	if _, err := s.News(context.Background(), NewsQuery{}); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("got %v, want ErrNotConfigured", err)
	}
	f := newNewsFake()
	f.err = ErrUnavailable
	if _, err := newsService(f, nyClock()).News(context.Background(), NewsQuery{Symbols: []Symbol{"AAPL"}}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("got %v, want the vendor's error", err)
	}
}

func TestStaleCompanyNewsIsServedWhenTheVendorFails(t *testing.T) {
	f := newNewsFake()
	f.company["AAPL"] = []NewsArticle{article("fh-1", "Apple headline long enough to matter", "Yahoo", "https://y.com/1", newsT0, "AAPL")}
	clk := nyClock()
	s := newsService(f, clk)
	ctx := context.Background()
	if _, err := s.News(ctx, NewsQuery{Symbols: []Symbol{"AAPL"}}); err != nil {
		t.Fatal(err)
	}
	clk.advance(companyNewsTTL + time.Minute)
	f.err = ErrUnavailable
	res, err := s.News(ctx, NewsQuery{Symbols: []Symbol{"AAPL"}})
	if err != nil || res.Total != 1 || !res.Freshness.Stale {
		t.Fatalf("stale fallback: %+v %v", res, err)
	}
}
