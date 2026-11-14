package supabaseplay

import (
	"context"
	"encoding/json"
)

// The Deep Cut functions answer with a JSON object whose `outcome` says what
// happened. This client passes the object through: what each outcome means over
// HTTP is the service's decision, and the shape of a turn is the client's.

// DeepCut calls one Deep Cut function as the caller (an empty token is a guest).
func (c *Client) DeepCut(ctx context.Context, function string, payload map[string]any, accessToken string) (json.RawMessage, error) {
	var raw json.RawMessage
	if err := c.rpc(ctx, "deep-cut", function, payload, accessToken, &raw); err != nil {
		return nil, err
	}
	return raw, nil
}
