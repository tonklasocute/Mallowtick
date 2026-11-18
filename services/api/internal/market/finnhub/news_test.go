package finnhub

import (
	"context"
	"net/http"
	"testing"
	"time"
)

func TestCompanyNewsKeepsOnlyLinkableArticles(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/company-news": func(w http.ResponseWriter, r *http.Request) {
			q := r.URL.Query()
			if q.Get("symbol") != "AAPL" || q.Get("from") != "2026-11-11" || q.Get("to") != "2026-11-17" {
				t.Errorf("query = %s", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`[
				{"category":"company","datetime":1794955620,"headline":" Software selloff ","id":143886409,"image":"https://img","related":"AAPL","source":"Yahoo","summary":"People are…","url":"https://finnhub.io/api/news?id=658d"},
				{"category":"company","datetime":1794955000,"headline":"Marvell rises","id":143886410,"related":"MRVL,AAPL","source":"","summary":"","url":"https://finnhub.io/api/news?id=77"},
				{"category":"company","datetime":1794955000,"headline":"No link","id":1,"url":"javascript:alert(1)"},
				{"category":"company","datetime":0,"headline":"No time","id":2,"url":"https://x.com"},
				{"category":"company","datetime":1794955000,"headline":"","id":3,"url":"https://x.com"}
			]`))
		},
	}, 60)
	got, err := c.CompanyNews(context.Background(), "AAPL", "2026-11-11", "2026-11-17")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d articles, want the 2 with a headline, a time and an http(s) link", len(got))
	}
	a := got[0]
	if a.ID != "fh-143886409" || a.Headline != "Software selloff" || a.Source != "Yahoo" || a.Provider != "finnhub" ||
		!a.PublishedAt.Equal(time.Unix(1794955620, 0)) || a.URL != "https://finnhub.io/api/news?id=658d" {
		t.Fatalf("article = %+v", a)
	}
	if b := got[1]; b.Source != "" || len(b.Related) != 2 || b.Related[0] != "MRVL" {
		t.Fatalf("an unnamed publisher stays unnamed, related tickers are kept: %+v", b)
	}
}

func TestMarketNewsCategory(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/news": func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("category") != "merger" {
				t.Errorf("category = %q", r.URL.Query().Get("category"))
			}
			_, _ = w.Write([]byte(`[{"category":"merger","datetime":1794968160,"headline":"Deal talk","id":8773351,"related":"","source":"Reuters","url":"https://news.google.com/rss/articles/CBM"}]`))
		},
	}, 60)
	got, err := c.MarketNews(context.Background(), "merger")
	if err != nil || len(got) != 1 || len(got[0].Related) != 0 || got[0].Category != "merger" {
		t.Fatalf("got %+v %v", got, err)
	}
}
