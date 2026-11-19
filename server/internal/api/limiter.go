package api

import (
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// limiter is a per-key token bucket with idle eviction.
type limiter struct {
	mu      sync.Mutex
	rps     rate.Limit
	burst   int
	buckets map[string]*bucket
	lastGC  time.Time
}

type bucket struct {
	lim  *rate.Limiter
	seen time.Time
}

func newLimiter(rps float64, burst int) *limiter {
	if burst < 1 {
		burst = 1
	}
	return &limiter{rps: rate.Limit(rps), burst: burst, buckets: map[string]*bucket{}}
}

func (l *limiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if now.Sub(l.lastGC) > time.Minute {
		for k, b := range l.buckets {
			if now.Sub(b.seen) > 10*time.Minute {
				delete(l.buckets, k)
			}
		}
		l.lastGC = now
	}
	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{lim: rate.NewLimiter(l.rps, l.burst)}
		l.buckets[key] = b
	}
	b.seen = now
	return b.lim.AllowN(now, 1)
}
