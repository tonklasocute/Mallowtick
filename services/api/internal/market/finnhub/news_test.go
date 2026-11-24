package finnhub

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/tonklasocute/mallowtick/services/api/internal/market"
)

// newsItem is one /company-news row in the shape checked on 2026-11-07.
func newsItem(id int, unix int64, headline, summary, source, link string) string {
	return fmt.Sprintf(`{"category":"company","datetime":%d,"headline":%q,"id":%d,`+
		`"image":"https://s.yimg.com/rz/stage/p/yahoo_finance_en-US_h_p_finance_2.png","related":"RKLB",`+
		`"source":%q,"summary":%q,"url":%q}`, unix, headline, id, source, summary, link)
}

func finnhubLink(id int) string { return fmt.Sprintf("https://finnhub.io/api/news?id=%064x", id) }

func TestCompanyNewsMapsArticles(t *testing.T) {
	long := strings.Repeat("Rocket Lab lost nearly 65% of its value, reflecting excessive expectations. ", 7)
	body := "[" + strings.Join([]string{
		newsItem(3, 1793955038, "Rocket Lab Stock Pulls Out of a Nosedive Friday: What's Going On?",
			"Rocket Lab shares are trading higher Friday ahead of Monday&#39;s earnings report,\n rebounding.", "Benzinga", finnhubLink(3)),
		newsItem(4, 1794031220, "Cathie Wood-Led Ark Loads Up On GOOG", long, "Yahoo", finnhubLink(4)),
		newsItem(5, 1793953500, "Rocket Lab Q3 Earnings Preview", "", "SeekingAlpha", finnhubLink(5)),
		newsItem(6, 1794000000, "Plain http link", "", "Yahoo", "http://example.com/a"),
		newsItem(7, 1794000001, "Script link", "", "Yahoo", "javascript:alert(1)"),
		newsItem(8, 1794000002, "No link", "", "Yahoo", ""),
		newsItem(9, 1794000003, "   ", "", "Yahoo", finnhubLink(9)),
		newsItem(10, 0, "No time", "", "Yahoo", finnhubLink(10)),
		newsItem(11, 1793953000, "Same link twice", "", "Yahoo", finnhubLink(3)),
	}, ",") + "]"
	var query string
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/company-news": func(w http.ResponseWriter, r *http.Request) {
			query = r.URL.RawQuery
			_, _ = w.Write([]byte(body))
		},
	}, 60)

	// 03:00 UTC on Nov 7 is still Nov 6 in New York.
	to := time.Date(2026, 11, 7, 3, 0, 0, 0, time.UTC)
	got, err := c.CompanyNews(context.Background(), "RKLB", to.Add(-7*24*time.Hour), to, 10)
	if err != nil {
		t.Fatal(err)
	}
	if query != "from=2026-10-30&symbol=RKLB&to=2026-11-06" {
		t.Fatalf("query = %q, want US market dates", query)
	}
	if len(got) != 3 {
		t.Fatalf("only articles with an https link, a headline and a time are kept, once each: %+v", got)
	}
	if got[0].Headline != "Cathie Wood-Led Ark Loads Up On GOOG" || got[1].Source != "Benzinga" ||
		got[2].Headline != "Rocket Lab Q3 Earnings Preview" {
		t.Fatalf("articles should be newest first: %+v", got)
	}
	b := got[1]
	if b.Summary != "Rocket Lab shares are trading higher Friday ahead of Monday's earnings report, rebounding." ||
		b.URL != finnhubLink(3) || !b.PublishedAt.Equal(time.Unix(1793955038, 0)) || b.PublishedAt.Location() != time.UTC {
		t.Fatalf("fields not mapped (entities decoded, white space collapsed): %+v", b)
	}
	if s := got[0].Summary; utf8.RuneCountInString(s) > newsSummaryRunes+1 || !strings.HasSuffix(s, "…") ||
		strings.HasSuffix(s, " …") || !strings.HasPrefix(long, strings.TrimSuffix(s, "…")) {
		t.Fatalf("a long summary should be cut at a word with an ellipsis: %q", s)
	}
	if got[2].Summary != "" {
		t.Fatalf("a missing summary stays empty: %q", got[2].Summary)
	}
}

func TestCompanyNewsKeepsTheNewest(t *testing.T) {
	var items []string
	for i := range 14 {
		// Oldest first, unlike Finnhub, so the order must come from the times.
		items = append(items, newsItem(i, 1793900000+int64(i)*600, fmt.Sprintf("Story %d", i), "", "Yahoo", finnhubLink(i)))
	}
	c := newTestClient(t, map[string]http.HandlerFunc{"/company-news": respond("[" + strings.Join(items, ",") + "]")}, 60)
	now := time.Unix(1794000000, 0)
	got, err := c.CompanyNews(context.Background(), "RKLB", now.Add(-7*24*time.Hour), now, 10)
	if err != nil || len(got) != 10 {
		t.Fatalf("got %d articles, err %v; want 10", len(got), err)
	}
	if got[0].Headline != "Story 13" || got[9].Headline != "Story 4" {
		t.Fatalf("the 10 newest should be kept, newest first: %q … %q", got[0].Headline, got[9].Headline)
	}

	empty := newTestClient(t, map[string]http.HandlerFunc{"/company-news": respond("[]")}, 60)
	if got, err := empty.CompanyNews(context.Background(), "SPY", now, now, 10); err != nil || got == nil || len(got) != 0 {
		t.Fatalf("no news: %+v %v", got, err)
	}
}

func TestCompanyNewsErrors(t *testing.T) {
	for _, tc := range []struct {
		code int
		want error
	}{
		{http.StatusForbidden, market.ErrNotEntitled},
		{http.StatusUnauthorized, market.ErrUnauthorized},
		{http.StatusTooManyRequests, market.ErrRateLimited},
		{http.StatusInternalServerError, market.ErrUnavailable},
	} {
		c := newTestClient(t, map[string]http.HandlerFunc{
			"/company-news": status(tc.code, `{"error":"You don't have access to this resource."}`),
		}, 60)
		now := time.Unix(1794000000, 0)
		if _, err := c.CompanyNews(context.Background(), "RKLB", now, now, 10); !errors.Is(err, tc.want) {
			t.Errorf("%d: got %v, want %v", tc.code, err, tc.want)
		}
	}
}

func TestCompanyNewsSpendsTheClientsShare(t *testing.T) {
	var calls atomic.Int32
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/company-news": func(w http.ResponseWriter, _ *http.Request) {
			calls.Add(1)
			_, _ = w.Write([]byte("[]"))
		},
	}, 60)
	ctx := market.WithAllowance(context.Background(), &oneCall{})
	now := time.Unix(1794000000, 0)
	if _, err := c.CompanyNews(ctx, "RKLB", now, now, 10); err != nil {
		t.Fatal(err)
	}
	if _, err := c.CompanyNews(ctx, "AAPL", now, now, 10); !errors.Is(err, market.ErrRateLimited) || calls.Load() != 1 {
		t.Fatalf("a client over its share must not reach the provider: err %v, calls %d", err, calls.Load())
	}
	if c.budget.Available() != 59 {
		t.Fatalf("the call should come out of the shared budget too; available = %d", c.budget.Available())
	}
}
