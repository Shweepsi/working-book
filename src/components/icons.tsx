// The app's icons: Lucide's (lucide.dev), drawn at one size and one stroke so
// a row of them reads as one set. Every icon of the app comes from here.

import type { LucideIcon, LucideProps } from 'lucide-react';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Calculator,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  ClipboardPaste,
  Clock,
  CloudOff,
  Columns3,
  CornerUpRight,
  Eraser,
  Eye,
  EyeOff,
  GripVertical,
  Import,
  Menu,
  MessageSquare,
  Minus,
  Moon,
  Pencil,
  Plus,
  Printer,
  Redo2,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Sun,
  SunMoon,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react';

/** 16 px, stroke 1.75: the header's buttons are 30 px, a field's text 14 to 16. */
const make = (Icon: LucideIcon) =>
  function AppIcon({ size = 16, strokeWidth = 1.75, ...rest }: LucideProps) {
    return <Icon size={size} strokeWidth={strokeWidth} aria-hidden="true" focusable="false" {...rest} />;
  };

export const BilanIcon = make(ChartColumn);
export const CalcIcon = make(Calculator);
export const PrintIcon = make(Printer);
export const MenuIcon = make(Menu);
export const UndoIcon = make(Undo2);
export const RedoIcon = make(Redo2);
export const CloseIcon = make(X);
export const CommentIcon = make(MessageSquare);
export const SettingsIcon = make(Settings);
export const PrevIcon = make(ChevronLeft);
export const NextIcon = make(ChevronRight);
export const BackIcon = make(ArrowLeft);
export const UpIcon = make(ArrowUp);
export const DownIcon = make(ArrowDown);
export const AddIcon = make(Plus);
export const MinusIcon = make(Minus);
export const RefreshIcon = make(RefreshCw);
export const WarnIcon = make(TriangleAlert);
export const CheckIcon = make(Check);
export const OfflineIcon = make(CloudOff);
export const LocalIcon = make(Circle);
export const GripIcon = make(GripVertical);
export const PasteIcon = make(ClipboardPaste);
export const ClearIcon = make(Eraser);
export const DeleteIcon = make(Trash2);
export const ThemeAutoIcon = make(SunMoon);
export const ThemeLightIcon = make(Sun);
export const ThemeDarkIcon = make(Moon);
export const ClockIcon = make(Clock);
export const ExpandIcon = make(ChevronDown);
export const CollapseIcon = make(ChevronUp);
export const SearchIcon = make(Search);
export const ElsewhereIcon = make(CornerUpRight);
export const EditIcon = make(Pencil);
export const ArchiveIcon = make(ArrowDownToLine);
export const ImportIcon = make(Import);
export const ToIcon = make(ArrowRight);
export const ResetIcon = make(RotateCcw);
export const ColumnsIcon = make(Columns3);
export const ShownIcon = make(Eye);
export const HiddenIcon = make(EyeOff);
