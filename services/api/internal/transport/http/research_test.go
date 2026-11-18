package httptransport

import (
	"net/http"
	"testing"
)

func TestResearchRoutes(t *testing.T) {
	rs := &stubResearch{}
	for target, want := range map[string]int{
		"/api/v1/research/briefing":                    0,
		"/api/v1/research/briefing?symbols=aapl,nvda":  2,
		"/api/v1/research/insights?symbols=AAPL":       1,
		"/api/v1/research/compare?symbols=AAPL,MSFT,X": 3,
	} {
		rs.last = nil
		rec, _ := doWith(t, &stubService{}, rs, http.MethodGet, target, nil)
		if rec.Code != http.StatusOK || len(rs.last) != want {
			t.Errorf("%s: %d, symbols %v", target, rec.Code, rs.last)
		}
	}
	// Without a research service the routes don't exist.
	if rec, _ := do(t, &stubService{}, http.MethodGet, "/api/v1/research/briefing", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("got %d", rec.Code)
	}
}

func TestResearchValidation(t *testing.T) {
	for _, target := range []string{
		"/api/v1/research/insights",
		"/api/v1/research/compare?symbols=AAPL",
		"/api/v1/research/compare?symbols=A,B,C,D,E",
		"/api/v1/research/briefing?symbols=A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z",
		"/api/v1/research/insights?symbols=not!valid",
	} {
		rec, env := doWith(t, &stubService{}, &stubResearch{}, http.MethodGet, target, nil)
		if rec.Code != http.StatusBadRequest || env.Error == nil || env.Error.Code != "invalid_request" {
			t.Errorf("%s: %d %s", target, rec.Code, rec.Body)
		}
	}
}
