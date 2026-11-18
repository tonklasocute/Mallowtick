package httptransport

import (
	"net/http"
	"strings"
	"testing"
)

func TestNewsRoutes(t *testing.T) {
	svc := &stubService{}
	rec, _ := do(t, svc, http.MethodGet, "/api/v1/news?symbols=aapl,msft&page=2&limit=5", nil)
	if rec.Code != http.StatusOK || len(svc.lastBatch) != 2 || !strings.Contains(rec.Body.String(), `"page":2,"limit":5`) {
		t.Fatalf("news: %d %s", rec.Code, rec.Body)
	}
	rec, _ = do(t, svc, http.MethodGet, "/api/v1/news", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"page":1,"limit":20`) {
		t.Fatalf("defaults: %d %s", rec.Code, rec.Body)
	}
	if rec, _ = do(t, svc, http.MethodGet, "/api/v1/news/fh-1", nil); rec.Code != http.StatusOK {
		t.Fatalf("article: %d", rec.Code)
	}
	if rec, _ = do(t, svc, http.MethodGet, "/api/v1/news/fh-2", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown article: %d", rec.Code)
	}
}

func TestNewsValidation(t *testing.T) {
	for _, target := range []string{
		"/api/v1/news?symbols=A,B,C,D,E,F,G,H,I,J,K",
		"/api/v1/news?category=crypto",
		"/api/v1/news?category=company",
		"/api/v1/news?page=0",
		"/api/v1/news?limit=500",
		"/api/v1/news?from=2026-11-10&to=2026-11-01",
		"/api/v1/news?from=2020-01-01",
		"/api/v1/news/not%20an%20id",
		"/api/v1/news/javascript:alert(1)",
	} {
		rec, env := do(t, &stubService{}, http.MethodGet, target, nil)
		if rec.Code != http.StatusBadRequest || env.Error == nil || env.Error.Code != "invalid_request" {
			t.Errorf("%s: %d %s", target, rec.Code, rec.Body)
		}
	}
}
