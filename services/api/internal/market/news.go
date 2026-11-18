package market

import (
	"cmp"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode"

	"golang.org/x/sync/errgroup"

	"github.com/tonklasocute/mallowtick/services/api/internal/cache"
)

// NewsArticle is one story as the vendor published it. Nothing is rewritten:
// the headline, summary, publisher and link are the vendor's.
type NewsArticle struct {
	// ID is stable and URL-safe: the vendor's prefix and its article id.
	ID       string `json:"id"`
	Headline string `json:"headline"`
	// Summary is "" when the vendor gives none.
	Summary string `json:"summary"`
	// URL is the link the vendor gave; Finnhub's go through a redirect to the
	// publisher's page.
	URL string `json:"url"`
	// Source is the publisher as the vendor names it ("Reuters", "Yahoo").
	Source      string    `json:"source"`
	PublishedAt time.Time `json:"publishedAt"`
	// Category is the vendor's ("company", "top news", "business", "merger").
	Category string `json:"category"`
	// Related are the tickers the vendor tied the story to.
	Related []string `json:"related"`
	// Sources lists every publication of this story that was grouped into it,
	// the article itself first, so each publisher keeps its credit and link.
	Sources []NewsSource `json:"sources"`
	// Provider is the vendor that supplied it.
	Provider string `json:"provider"`
}

// NewsSource is one publication of a story.
type NewsSource struct {
	ID          string    `json:"id"`
	Source      string    `json:"source"`
	URL         string    `json:"url"`
	PublishedAt time.Time `json:"publishedAt"`
}

// NewsProvider is implemented by vendors that publish news.
type NewsProvider interface {
	// MarketNews returns the latest general market news in category.
	MarketNews(ctx context.Context, category string) ([]NewsArticle, error)
	// CompanyNews returns symbol's news published from from to to (YYYY-MM-DD).
	CompanyNews(ctx context.Context, symbol Symbol, from, to string) ([]NewsArticle, error)
}

// Market news categories the API serves.
const (
	NewsGeneral = "general"
	NewsMerger  = "merger"
)

const (
	// NewsMaxSymbols bounds one company-news request; newsFetches is how many
	// of them may miss the cache and be fetched in one request. The rest are
	// reported as rate_limited and come with a later request, so a long
	// watchlist never takes a minute's budget at once.
	NewsMaxSymbols = 10
	newsFetches    = 5
	// NewsWindowDays is how far back company news is kept (and can be filtered).
	NewsWindowDays = 7
	marketNewsTTL  = 10 * time.Minute
	companyNewsTTL = 30 * time.Minute
	// articleTTL keeps served articles findable by id.
	articleTTL = 24 * time.Hour
	// NewsMaxLimit bounds a page.
	NewsMaxLimit     = 50
	NewsDefaultLimit = 20
	// Stories with the same headline are grouped only when published this close.
	sameStoryWindow = 48 * time.Hour
)

// NewsQuery selects news: company news for Symbols, else market news in Category.
type NewsQuery struct {
	Symbols  []Symbol
	Category string
	// From and To are YYYY-MM-DD New York dates; empty means no bound.
	From, To string
	Page     int
	Limit    int
}

// NewsResult is a page of grouped, newest-first articles.
type NewsResult struct {
	Articles []NewsArticle `json:"articles"`
	Page     int           `json:"page"`
	Limit    int           `json:"limit"`
	// Total counts the grouped articles across pages.
	Total   int  `json:"total"`
	HasMore bool `json:"hasMore"`
	// Unavailable lists symbols whose news could not be included this time.
	Unavailable []UnavailableSymbol `json:"unavailable"`
	Freshness   Freshness           `json:"freshness"`
}

// News returns grouped news for q. It fails with ErrNotConfigured without a
// vendor that publishes news.
func (s *Service) News(ctx context.Context, q NewsQuery) (NewsResult, error) {
	np, ok := s.source(KindNews).(NewsProvider)
	if !ok {
		return NewsResult{}, ErrNotConfigured
	}
	var (
		articles    []NewsArticle
		entries     []cache.Entry[[]NewsArticle]
		stale       bool
		unavailable = []UnavailableSymbol{}
	)
	if len(q.Symbols) == 0 {
		category := cmp.Or(q.Category, NewsGeneral)
		e, st, err := load(ctx, s, s.marketNews, "news:"+category, fixedTTL[[]NewsArticle](marketNewsTTL),
			func(fctx context.Context) ([]NewsArticle, error) { return np.MarketNews(fctx, category) })
		if err != nil {
			return NewsResult{}, err
		}
		articles, entries, stale = e.Value, append(entries, e), st
	} else {
		got, errs := s.companyNews(ctx, np, q.Symbols)
		for _, sym := range q.Symbols {
			if e, ok := got[sym]; ok {
				articles = append(articles, e.entry.Value...)
				entries = append(entries, e.entry)
				stale = stale || e.stale
			} else {
				unavailable = append(unavailable, UnavailableSymbol{Symbol: sym, Reason: ErrorCode(errs[sym])})
			}
		}
		if len(entries) == 0 {
			if err := firstProviderError(q.Symbols, errs); err != nil {
				return NewsResult{}, err
			}
		}
	}

	grouped := GroupNews(articles)
	filtered := grouped[:0:0]
	for _, a := range grouped {
		day := a.PublishedAt.In(newYorkLocation()).Format(time.DateOnly)
		if (q.From == "" || day >= q.From) && (q.To == "" || day <= q.To) {
			filtered = append(filtered, a)
		}
	}
	s.rememberArticles(filtered)

	limit := min(max(q.Limit, 1), NewsMaxLimit)
	if q.Limit == 0 {
		limit = NewsDefaultLimit
	}
	page := max(q.Page, 1)
	start := min((page-1)*limit, len(filtered))
	end := min(start+limit, len(filtered))
	res := NewsResult{
		Articles: slices.Clone(filtered[start:end]), Page: page, Limit: limit, Total: len(filtered),
		HasMore: end < len(filtered), Unavailable: unavailable,
	}
	var newest *time.Time
	if len(filtered) > 0 {
		t := filtered[0].PublishedAt
		newest = &t
	}
	fetchedAt := time.Time{}
	for _, e := range entries {
		if fetchedAt.IsZero() || e.StoredAt.Before(fetchedAt) {
			fetchedAt = e.StoredAt
		}
	}
	if fetchedAt.IsZero() {
		fetchedAt = s.cfg.Now()
	}
	res.Freshness = s.freshness(KindNews, newest, fetchedAt, stale)
	return res, nil
}

type newsEntry struct {
	entry cache.Entry[[]NewsArticle]
	stale bool
}

// companyNews returns each symbol's cached news, fetching at most newsFetches
// missing symbols. The others get ErrRateLimited.
func (s *Service) companyNews(ctx context.Context, np NewsProvider, symbols []Symbol) (map[Symbol]newsEntry, map[Symbol]error) {
	today := s.Today()
	from := AddDays(today, -(NewsWindowDays - 1))
	var (
		mu      sync.Mutex
		got     = make(map[Symbol]newsEntry, len(symbols))
		errs    = make(map[Symbol]error)
		fetches int
	)
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(3)
	for _, sym := range symbols {
		key := "cnews:" + string(sym)
		e, state := s.companyNewsCache.Get(key)
		if state == cache.Fresh || fetches >= newsFetches {
			mu.Lock()
			switch state {
			case cache.Fresh:
				got[sym] = newsEntry{entry: e}
			case cache.Stale:
				// Not fetched now: a stale copy is still better than nothing.
				got[sym] = newsEntry{entry: e, stale: true}
			default:
				errs[sym] = ErrRateLimited
			}
			mu.Unlock()
			continue
		}
		fetches++
		g.Go(func() error {
			e, st, err := load(gctx, s, s.companyNewsCache, key, fixedTTL[[]NewsArticle](companyNewsTTL),
				func(fctx context.Context) ([]NewsArticle, error) { return np.CompanyNews(fctx, sym, from, today) })
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				errs[sym] = err
			} else {
				got[sym] = newsEntry{entry: e, stale: st}
			}
			return nil // one symbol failing leaves the others
		})
	}
	_ = g.Wait()
	return got, errs
}

// CachedCompanyNews returns symbol's news without fetching, and whether any
// was cached (fresh or stale).
func (s *Service) CachedCompanyNews(symbol Symbol) ([]NewsArticle, bool) {
	e, state := s.companyNewsCache.Get("cnews:" + string(symbol))
	return e.Value, state != cache.Miss
}

func (s *Service) rememberArticles(articles []NewsArticle) {
	for _, a := range articles {
		s.articles.Set(a.ID, a)
	}
}

// Article returns an article served earlier, by id. Articles are not stored:
// one that was never listed, or listed more than a day ago, is not found.
func (s *Service) Article(_ context.Context, id string) (NewsArticle, error) {
	if e, state := s.articles.Get(id); state == cache.Fresh {
		return e.Value, nil
	}
	return NewsArticle{}, ErrNotFound
}

// GroupNews merges duplicates and returns the stories newest first. Two
// articles are one story when they share the vendor's id, the normalised URL,
// the normalised summary (content hash), or a normalised headline of at least
// five words published within two days of each other. The earliest
// publication leads; the others are kept in Sources, and Related is merged.
func GroupNews(articles []NewsArticle) []NewsArticle {
	sorted := slices.Clone(articles)
	slices.SortStableFunc(sorted, func(a, b NewsArticle) int {
		return cmp.Or(a.PublishedAt.Compare(b.PublishedAt), cmp.Compare(a.ID, b.ID))
	})
	var groups []NewsArticle
	byKey := make(map[string]int) // identity key -> index in groups
	for _, a := range sorted {
		keys := storyKeys(a)
		gi := -1
		for _, k := range keys {
			if i, ok := byKey[k]; ok {
				if strings.HasPrefix(k, "h:") && a.PublishedAt.Sub(groups[i].PublishedAt) > sameStoryWindow {
					continue
				}
				gi = i
				break
			}
		}
		if gi < 0 {
			a.Related = slices.Clone(a.Related)
			a.Sources = []NewsSource{{ID: a.ID, Source: a.Source, URL: a.URL, PublishedAt: a.PublishedAt}}
			groups = append(groups, a)
			gi = len(groups) - 1
		} else {
			g := &groups[gi]
			for _, r := range a.Related {
				if !slices.Contains(g.Related, r) {
					g.Related = append(g.Related, r)
				}
			}
			if !slices.ContainsFunc(g.Sources, func(src NewsSource) bool { return src.ID == a.ID }) {
				g.Sources = append(g.Sources, NewsSource{ID: a.ID, Source: a.Source, URL: a.URL, PublishedAt: a.PublishedAt})
			}
			if g.Summary == "" {
				g.Summary = a.Summary
			}
		}
		for _, k := range keys {
			if _, ok := byKey[k]; !ok {
				byKey[k] = gi
			}
		}
	}
	for i := range groups {
		slices.Sort(groups[i].Related)
	}
	slices.SortStableFunc(groups, func(a, b NewsArticle) int {
		return cmp.Or(b.PublishedAt.Compare(a.PublishedAt), cmp.Compare(a.ID, b.ID))
	})
	if groups == nil {
		groups = []NewsArticle{}
	}
	return groups
}

// storyKeys are an article's identity keys, most specific first.
func storyKeys(a NewsArticle) []string {
	keys := []string{"id:" + a.ID}
	if u := NormalizeURL(a.URL); u != "" {
		keys = append(keys, "u:"+u)
	}
	if s := normalizeText(a.Summary); len(s) >= 80 {
		keys = append(keys, "c:"+hash(s))
	}
	if h := normalizeHeadline(a.Headline, a.Source); len(strings.Fields(h)) >= 5 {
		keys = append(keys, "h:"+hash(h))
	}
	return keys
}

func hash(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:8])
}

// trackingParams are dropped from URLs before comparing them.
var trackingParams = regexp.MustCompile(`^(utm_.*|fbclid|gclid|mc_cid|mc_eid|cmpid|ocid|guccounter)$`)

// NormalizeURL lowercases the scheme and host, drops "www.", the fragment,
// tracking parameters and a trailing slash, and sorts the query. It returns ""
// for anything but an absolute http(s) URL.
func NormalizeURL(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return ""
	}
	q := u.Query()
	for k := range q {
		if trackingParams.MatchString(strings.ToLower(k)) {
			q.Del(k)
		}
	}
	host := strings.TrimPrefix(strings.ToLower(u.Host), "www.")
	path := strings.TrimRight(u.EscapedPath(), "/")
	out := "https://" + host + path
	if enc := q.Encode(); enc != "" { // Encode sorts by key
		out += "?" + enc
	}
	return out
}

// normalizeHeadline drops a trailing " - Publisher" or " | Publisher" and
// normalises the rest.
func normalizeHeadline(headline, source string) string {
	h := strings.TrimSpace(headline)
	for _, sep := range []string{" - ", " | ", " — "} {
		if i := strings.LastIndex(h, sep); i > 0 {
			tail := strings.TrimSpace(h[i+len(sep):])
			if strings.EqualFold(tail, source) || len(strings.Fields(tail)) <= 3 {
				h = h[:i]
			}
		}
	}
	return normalizeText(h)
}

// normalizeText lowercases, keeps letters and digits of any script, and
// collapses everything else to single spaces.
func normalizeText(s string) string {
	var b strings.Builder
	space := false
	for _, r := range strings.ToLower(s) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			space = false
		} else if !space && b.Len() > 0 {
			b.WriteByte(' ')
			space = true
		}
	}
	return strings.TrimSpace(b.String())
}
