import {
  Accessibility,
  Bell,
  HelpCircle,
  Info,
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
    label: "Account",
    items: [
      {
        slug: "account",
        title: "Email & password",
        desc: "How you sign in",
        icon: User,
        pageTitle: "Email & password",
      },
      { slug: "profile", title: "Profile", desc: "Photo, name, username, bio", icon: UserCircle },
      {
        slug: "security",
        title: "Security",
        desc: "Two-step verification, sessions",
        icon: Shield,
      },
      {
        slug: "connected",
        title: "Connected accounts",
        desc: "Google",
        icon: Link2,
        pageTitle: "Connected accounts",
      },
    ],
  },
  {
    label: "Preferences",
    items: [
      { slug: "privacy", title: "Privacy", desc: "Who can see your activity", icon: Lock },
      { slug: "notifications", title: "Notifications", desc: "Push and email", icon: Bell },
      { slug: "appearance", title: "Appearance", desc: "Dark, light, system", icon: Palette },
      {
        slug: "accessibility",
        title: "Accessibility",
        desc: "Motion, contrast, text size",
        icon: Accessibility,
      },
      {
        slug: "blocked",
        title: "Blocked users",
        desc: "People you've blocked",
        icon: ShieldOff,
        pageTitle: "Blocked users",
      },
    ],
  },
  {
    label: "Support",
    items: [
      {
        slug: "feedback",
        title: "Send feedback",
        desc: "Ideas, bugs, kind words",
        icon: MessageSquareHeart,
        pageTitle: "Send feedback",
      },
      { slug: "help", title: "Help", desc: "FAQ and contact", icon: HelpCircle, pageTitle: "Help" },
      {
        slug: "terms",
        title: "Terms & Conditions",
        desc: "",
        icon: ScrollText,
        pageTitle: "Terms & Conditions",
      },
      {
        slug: "privacy-policy",
        title: "Privacy Policy",
        desc: "",
        icon: FileText,
        pageTitle: "Privacy Policy",
      },
      {
        slug: "about",
        title: "About",
        desc: "Version and source",
        icon: Info,
        pageTitle: "About",
      },
    ],
  },
];

export const allSettings = settingsGroups.flatMap((g) => g.items);
