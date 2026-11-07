package market

import (
	"context"
	"fmt"
)

// Allowance is one client's share of the vendors' budgets. The transport puts
// it in the request context; adapters take from it right before spending
// their own budget, so data served from cache never counts against a client.
type Allowance interface {
	// Take books units of vendor's budget for the client and reports whether
	// the client still had them.
	Take(vendor string, units int) bool
}

type allowanceKey struct{}

// WithAllowance returns a context whose provider calls spend from a.
func WithAllowance(ctx context.Context, a Allowance) context.Context {
	return context.WithValue(ctx, allowanceKey{}, a)
}

// TakeAllowance books units of vendor's budget against the client allowance in
// ctx. Calls without one (startup warm-up, tests) are not limited. The error
// wraps ErrRateLimited, so a stale cached value can still be served.
func TakeAllowance(ctx context.Context, vendor string, units int) error {
	a, ok := ctx.Value(allowanceKey{}).(Allowance)
	if !ok || a.Take(vendor, units) {
		return nil
	}
	return fmt.Errorf("%w: client allowance for %s used up", ErrRateLimited, vendor)
}
