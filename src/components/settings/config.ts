import {
  Accessibility,
  Bell,
  HelpCircle,
  Info,
  Languages,
  Link2,
  MessageSquareHeart,
  Lock,
  Palette,
  Shield,
  ShieldOff,
  User,
  UserCircle,
  FileText,
  ScrollText,
} from "lucide-react";

import { msg } from "@/lib/settings/language";
/**
 * One settings page. `pageTitle` is the browser tab's name when "<title> settings"
 * would read badly ("Help settings", "Blocked users settings").
 */
export type SettingsItem = {
  slug: string;
  title: string;
  desc: string;
  icon: typeof User;
  pageTitle?: string;
};

export const settingsGroups: { label: string; items: SettingsItem[] }[] = [
  {
    label: msg("Account"),
    items: [
      {
        slug: "account",
        title: msg("Email & password"),
        desc: msg("How you sign in"),
        icon: User,
        pageTitle: msg("Email & password"),
      },
      {
        slug: "profile",
        title: msg("Profile"),
        desc: msg("Photo, name, username, bio"),
        icon: UserCircle,
      },
      {
        slug: "security",
        title: msg("Security"),
        desc: msg("Two-step verification, sessions"),
        icon: Shield,
      },
      {
        slug: "connected",
        title: msg("Connected accounts"),
        desc: msg("Google"),
        icon: Link2,
        pageTitle: msg("Connected accounts"),
      },
    ],
  },
  {
    label: msg("Preferences"),
    items: [
      {
        slug: "privacy",
        title: msg("Privacy"),
        desc: msg("Who can see your activity"),
        icon: Lock,
      },
      {
        slug: "notifications",
        title: msg("Notifications"),
        desc: msg("Push and email"),
        icon: Bell,
      },
      {
        slug: "appearance",
        title: msg("Appearance"),
        desc: msg("Dark, light, system, New Year's"),
        icon: Palette,
      },
      {
        slug: "language",
        title: msg("Language"),
        desc: msg("English, Shqip"),
        icon: Languages,
        pageTitle: msg("Language"),
      },
      {
        slug: "accessibility",
        title: msg("Accessibility"),
        desc: msg("Motion, contrast, text size"),
        icon: Accessibility,
      },
      {
        slug: "blocked",
        title: msg("Blocked users"),
        desc: msg("People you've blocked"),
        icon: ShieldOff,
        pageTitle: msg("Blocked users"),
      },
    ],
  },
  {
    label: msg("Support"),
    items: [
      {
        slug: "feedback",
        title: msg("Send feedback"),
        desc: msg("Ideas, bugs, kind words"),
        icon: MessageSquareHeart,
        pageTitle: msg("Send feedback"),
      },
      {
        slug: "help",
        title: msg("Help"),
        desc: msg("FAQ and contact"),
        icon: HelpCircle,
        pageTitle: msg("Help"),
      },
      {
        slug: "terms",
        title: msg("Terms & Conditions"),
        desc: "",
        icon: ScrollText,
        pageTitle: msg("Terms & Conditions"),
      },
      {
        slug: "privacy-policy",
        title: msg("Privacy Policy"),
        desc: "",
        icon: FileText,
        pageTitle: msg("Privacy Policy"),
      },
      {
        slug: "about",
        title: msg("About"),
        desc: msg("Version and source"),
        icon: Info,
        pageTitle: msg("About"),
      },
    ],
  },
];

export const allSettings = settingsGroups.flatMap((g) => g.items);
