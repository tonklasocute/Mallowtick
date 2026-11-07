package market

import "slices"

// LogoSource is implemented by vendors that keep the company logos they have
// looked up. Search results are cached for a day, often before their logos are
// known, so the service fills them in from it when it answers.
type LogoSource interface {
	// CachedLogo returns symbol's logo without calling the vendor. known is
	// false when it has not been looked up yet; a known "" means no logo.
	CachedLogo(symbol Symbol) (logo string, known bool)
}

// withCachedLogos returns found with its empty logos filled in from src, when
// src keeps logos. found may be a cached value, so it is copied, never changed.
func withCachedLogos(found []Instrument, src Provider) []Instrument {
	logos, ok := src.(LogoSource)
	if !ok {
		return found
	}
	out := slices.Clone(found)
	for i := range out {
		if out[i].Logo == "" {
			out[i].Logo, _ = logos.CachedLogo(Symbol(out[i].Symbol))
		}
	}
	return out
}
