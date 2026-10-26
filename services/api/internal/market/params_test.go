package market

import (
	"errors"
	"strings"
	"testing"
)

func TestParseSymbol(t *testing.T) {
	valid := map[string]Symbol{"aapl": "AAPL", "\tBRK.B\n": "BRK.B", "spy": "SPY", "BF-B": "BF-B"}
	for in, want := range valid {
		got, err := ParseSymbol(in)
		if err != nil || got != want {
			t.Errorf("ParseSymbol(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, in := range []string{"", "1ABC", "AAPL;DROP", "TOOLONGSYMBOL", "A B", "../etc"} {
		if _, err := ParseSymbol(in); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("ParseSymbol(%q) should fail with ErrInvalidInput, got %v", in, err)
		}
	}
}

func TestParseSymbolList(t *testing.T) {
	got, err := ParseSymbolList("aapl, msft,AAPL,,nvda")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(symbolsToStrings(got), ",") != "AAPL,MSFT,NVDA" {
		t.Fatalf("got %v", got)
	}
	if _, err := ParseSymbolList(" , "); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("empty list should fail, got %v", err)
	}
	many := strings.Repeat("A,", MaxBatchSymbols) + "B,C"
	if _, err := ParseSymbolList(many); err != nil {
		t.Fatalf("duplicates should not count toward the limit: %v", err)
	}
	var tooMany []string
	for i := range MaxBatchSymbols + 1 {
		tooMany = append(tooMany, "A"+string(rune('A'+i%26))+string(rune('A'+i/26)))
	}
	if _, err := ParseSymbolList(strings.Join(tooMany, ",")); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("over-limit list should fail, got %v", err)
	}
}

func symbolsToStrings(s []Symbol) []string {
	out := make([]string, len(s))
	for i, v := range s {
		out[i] = string(v)
	}
	return out
}

func TestParseSearchQuery(t *testing.T) {
	if q, err := ParseSearchQuery("  apple   inc "); err != nil || q != "apple inc" {
		t.Fatalf("got %q, %v", q, err)
	}
	for _, in := range []string{"", "   ", strings.Repeat("a", 41), "<script>", "a/b"} {
		if _, err := ParseSearchQuery(in); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("ParseSearchQuery(%q) should fail, got %v", in, err)
		}
	}
}

func TestParseRange(t *testing.T) {
	if r, err := ParseRange("", Range1D); err != nil || r != Range1D {
		t.Fatalf("default: %v %v", r, err)
	}
	if r, err := ParseRange("1Y", Range1D); err != nil || r != Range1Y || r.Spec().Interval != Interval1Day {
		t.Fatalf("1Y: %v %v", r, err)
	}
	if _, err := ParseRange("10y", Range1D); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unsupported range should fail, got %v", err)
	}
	for _, r := range Ranges {
		if r.Spec().Bars <= 0 || r.Spec().CacheTTL <= 0 {
			t.Errorf("range %s has an incomplete spec", r)
		}
	}
}
