package publish

import (
	"fmt"
	"net/netip"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
)

// ParseAdminHTTPAllowedCIDRs opts specific private networks into HTTP admin
// access. An empty setting preserves HTTPS/loopback-only access.
func ParseAdminHTTPAllowedCIDRs(raw string) ([]netip.Prefix, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	private := []netip.Prefix{
		netip.MustParsePrefix("10.0.0.0/8"), netip.MustParsePrefix("172.16.0.0/12"),
		netip.MustParsePrefix("192.168.0.0/16"), netip.MustParsePrefix("fc00::/7"),
	}
	var networks []netip.Prefix
	for _, value := range strings.Split(raw, ",") {
		prefix, err := netip.ParsePrefix(strings.TrimSpace(value))
		if err != nil || prefix != prefix.Masked() {
			return nil, fmt.Errorf("expected a network CIDR, got %q", value)
		}
		allowed := false
		for _, block := range private {
			if block.Contains(prefix.Addr()) && prefix.Bits() >= block.Bits() {
				allowed = true
				break
			}
		}
		if !allowed {
			return nil, fmt.Errorf("HTTP admin CIDR must be entirely within a private network: %q", value)
		}
		networks = append(networks, prefix)
	}
	return networks, nil
}

func isAllowedLANAdminRequest(c *gin.Context, options Options) bool {
	if len(options.AdminHTTPAllowedCIDRs) == 0 {
		return false
	}
	// Only the configured public origin is eligible; a private client address
	// alone must not authorize a forged Host or an arbitrary HTTP origin.
	origin, err := url.Parse(options.PublicOrigin)
	if err != nil || origin.Scheme != "http" {
		return false
	}
	host, err := url.Parse("http://" + c.Request.Host)
	if err != nil || host.Hostname() != origin.Hostname() {
		return false
	}
	peer := parseRemoteIP(c.Request.RemoteAddr)
	if peer == nil {
		return false
	}
	client, ok := netip.AddrFromSlice(peer)
	if !ok {
		return false
	}
	if isTrustedProxyPeer(peer, options.TrustedProxies) {
		if c.GetHeader("X-Forwarded-Proto") != "http" {
			return false
		}
		// Nginx overwrites this single IP with $remote_addr. Never infer the
		// original client from a missing value or an attacker-supplied XFF list.
		client, err = netip.ParseAddr(c.GetHeader("X-Protoflow-Client-IP"))
		if err != nil {
			return false
		}
	}
	client = client.Unmap()
	for _, network := range options.AdminHTTPAllowedCIDRs {
		if network.Contains(client) {
			return true
		}
	}
	return false
}
