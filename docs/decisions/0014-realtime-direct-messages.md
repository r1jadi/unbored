# 0014 — Direct messages use the Data API and Realtime directly, and Realtime carries no text

* Status: accepted
* Date: 2026-11-04

## Context

[0008](0008-browser-data-access.md) says domain data goes through `/api/v1`, and that
live updates need their own decision. Direct messages force both questions:

1. **A chat has to feel instant.** Polling every few seconds doesn't. Players compare
   this with the messaging in every other social app they use.
2. **Where do reads and writes go?** In practice follows, likes, comments and
   notifications already use the Data API under RLS (`src/lib/supabase/rest.ts`), so
   0008 describes less than what the code does.

Supabase Realtime is available on the project. Broadcasting messages through it would
be the simplest thing, with one problem: Realtime keeps what it sends in
`realtime.messages` for days, on a table outside everything else this project
controls. A message a player unsent would still be sitting there.

## Decision

* **Direct messages use the Data API, not a Go service.** Reads are selects under RLS.
  Writes are `security definer` functions with no table grants behind them, which take
  the sender from `auth.uid()` and enforce blocks, the recipient's setting and rate
  limits in the same transaction as the write. A service in front would add a hop and
  a second place for those rules, and the socket connects to Supabase regardless.
* **Realtime carries signals, not messages.** The database sends "this chat changed" to
  `dm:user:<id>`, with the conversation id and a kind. Browsers then read through the
  Data API. No message text passes through Realtime, so unsending really removes it, and
  a read after a block or a deleted chat is still decided by RLS rather than by what a
  socket already sent.
* **Typing indicators are the exception, and they are not data.** The browsers broadcast
  them on `dm:conv:<id>` and they are stored by nothing we read.
* **Both topics are private.** Policies on `realtime.messages` decide who may join. A
  player can listen on their own signal topic and can't write to it; a conversation's
  topic is open only to its two players, not suspended, with no block between them.
* **Polling stays as the safety net.** While the socket is up it runs every minute, to
  catch a signal lost in a reconnect. While the socket is down it runs at full speed, so
  a Realtime outage makes messages slower, not missing.
* **The client is `@supabase/realtime-js`**, loaded on demand after sign-in, rather than
  all of `supabase-js`: the app already has its own auth and REST layers.

This supersedes 0008 for direct messages only. Its "no Realtime for domain data" still
holds for everything else, until a decision says otherwise.

## Consequences

* Every incoming message costs one signal plus one read, about one extra round trip
  over pushing the text itself. That is the price of the text not being in Realtime.
* A read position is withheld from the other player when either has "Seen" off, and so
  is the signal, whose timing would otherwise give it away.
* A join is authorized when it happens, so someone blocked mid-chat keeps an open typing
  channel until it reconnects. It can show "typing…" and nothing else: sending and
  reading are checked on every call.
* Realtime must stay enabled on the hosted project. If it isn't, nothing breaks, and
  chats fall back to polling.
* Connections count against the project's Realtime quota: one socket per signed-in tab.
