/**
 * What administrators have set for everyone: a banner, and whether comments and
 * messages are open. Read here to draw the right screen; the database enforces the
 * switches itself, so a stale copy can only show a form that then says it's paused.
 */

import { useQuery } from "@tanstack/react-query";

import { getQueryClient } from "@/lib/query";
import { restGet } from "@/lib/supabase/rest";

export type PublicPlatformSettings = {
  bannerText: string | null;
  commentsEnabled: boolean;
  messagesEnabled: boolean;
};

const OPEN: PublicPlatformSettings = {
  bannerText: null,
  commentsEnabled: true,
  messagesEnabled: true,
};

type Row = {
  banner_text: string | null;
  comments_enabled: boolean;
  messages_enabled: boolean;
};

export function usePlatformSettings(): PublicPlatformSettings {
  const query = useQuery(
    {
      queryKey: ["platform-settings"],
      queryFn: async (): Promise<PublicPlatformSettings> => {
        const row = await restGet<Row | null>("rpc/public_platform_settings");
        if (!row || typeof row !== "object" || !("comments_enabled" in row)) return OPEN;
        return {
          bannerText: row.banner_text ?? null,
          commentsEnabled: row.comments_enabled !== false,
          messagesEnabled: row.messages_enabled !== false,
        };
      },
      staleTime: 60_000,
      retry: false,
    },
    getQueryClient(),
  );
  // A failed read must not close anything: the database still has the final word.
  return query.data ?? OPEN;
}
