package finnhub

import (
	"context"
	"html"
	"net/url"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tonklasocute/mallowtick/services/api/internal/market"
)

var _ market.NewsProvider = (*Client)(nil)

// newsSummaryRunes caps an article's summary. Finnhub's run up to 500
// characters (checked 2026-11-07), more than a list needs.
const newsSummaryRunes = 280

// CompanyNews implements market.NewsProvider with one /company-news call. The
// free plan has it: checked 2026-11-07, a week of RKLB gave 68 articles (61
// Yahoo, 4 SeekingAlpha, 3 Benzinga) and SPY 246, newest first, each linking
// through https://finnhub.io/api/news?id=…. Images are not passed on: they
// come from many hosts.
func (c *Client) CompanyNews(ctx context.Context, sym market.Symbol, from, to time.Time, limit int) ([]market.NewsArticle, error) {
	ny, err := time.LoadLocation("America/New_York")
	if err != nil {
		ny = time.UTC
	}
	params := url.Values{
		"symbol": {string(sym)},
		"from":   {from.In(ny).Format(time.DateOnly)},
		"to":     {to.In(ny).Format(time.DateOnly)},
	}
	var rows []struct {
		Datetime int64  `json:"datetime"`
		Headline string `json:"headline"`
		Summary  string `json:"summary"`
		Source   string `json:"source"`
		URL      string `json:"url"`
	}
	if err := c.get(ctx, "/company-news", params, &rows); err != nil {
		return nil, err
	}
	out := make([]market.NewsArticle, 0, len(rows))
	seen := make(map[string]bool, len(rows))
	for _, r := range rows {
		// The browser opens the link, so only https ones are kept (the logo rule).
		link := cleanLogo(r.URL)
		headline := plainText(r.Headline)
		if link == "" || headline == "" || r.Datetime <= 0 || seen[link] {
			continue
		}
		seen[link] = true
		out = append(out, market.NewsArticle{
			Headline: headline, Summary: shorten(plainText(r.Summary), newsSummaryRunes),
			Source: plainText(r.Source), URL: link, PublishedAt: time.Unix(r.Datetime, 0).UTC(),
		})
	}
	slices.SortStableFunc(out, func(a, b market.NewsArticle) int { return b.PublishedAt.Compare(a.PublishedAt) })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// plainText decodes the HTML entities Finnhub leaves in some texts (Benzinga's
// "Monday&#39;s") and collapses runs of white space.
func plainText(s string) string {
	return strings.Join(strings.Fields(html.UnescapeString(s)), " ")
}

// shorten cuts s to at most n runes plus an ellipsis, at a word break when one
// is near the end.
func shorten(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	cut := string([]rune(s)[:n])
	if i := strings.LastIndexByte(cut, ' '); i >= len(cut)*3/4 {
		cut = cut[:i]
	}
	return strings.TrimRight(cut, " ,;:.-–—") + "…"
}
