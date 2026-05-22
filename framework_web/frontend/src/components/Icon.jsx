import React from 'react';
import * as LucideIcons from 'lucide-react';

const icons = {
  'layout-dashboard': LucideIcons.LayoutDashboard,
  map: LucideIcons.Map,
  'git-compare': LucideIcons.GitCompare,
  briefcase: LucideIcons.Briefcase,
  'bar-chart-3': LucideIcons.BarChart3,
  'flask-conical': LucideIcons.FlaskConical,
  'alert-triangle': LucideIcons.AlertTriangle,
  'shield-check': LucideIcons.ShieldCheck,
  'book-open': LucideIcons.BookOpen,
  download: LucideIcons.Download,
  upload: LucideIcons.Upload,
  'refresh-cw': LucideIcons.RefreshCw,
  settings: LucideIcons.Settings,
  eye: LucideIcons.Eye,
  'eye-off': LucideIcons.EyeOff,
  filter: LucideIcons.Filter,
  search: LucideIcons.Search,
  'sliders-horizontal': LucideIcons.SlidersHorizontal,
  'external-link': LucideIcons.ExternalLink,
  info: LucideIcons.Info,
  'help-circle': LucideIcons.HelpCircle,
  'chevron-right': LucideIcons.ChevronRight,
  'chevron-down': LucideIcons.ChevronDown,
  x: LucideIcons.X,
  check: LucideIcons.Check,
  'alert-circle': LucideIcons.AlertCircle,
  'alert-octagon': LucideIcons.AlertOctagon,
  shield: LucideIcons.Shield,
  flame: LucideIcons.Flame,
  play: LucideIcons.Play,
  crosshair: LucideIcons.Crosshair,
  'trending-up': LucideIcons.TrendingUp,
  'trending-down': LucideIcons.TrendingDown,
  activity: LucideIcons.Activity,
};

export function Icon({ name, size = 16, strokeWidth = 1.5, className = '' }) {
  const IconComponent = icons[name];
  if (!IconComponent) {
    console.warn(`Icon not found: ${name}`);
    return null;
  }
  return <IconComponent size={size} strokeWidth={strokeWidth} className={className} />;
}