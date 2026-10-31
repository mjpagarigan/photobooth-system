import {
  Aperture as LucideAperture,
  ArrowDown as LucideArrowDown,
  ArrowLeft as LucideArrowLeft,
  ArrowLeftRight as LucideArrowLeftRight,
  ArrowRight as LucideArrowRight,
  ArrowUp as LucideArrowUp,
  Calendar as LucideCalendar,
  Camera as LucideCamera,
  Check as LucideCheck,
  ChevronDown as LucideChevronDown,
  ChevronLeft as LucideChevronLeft,
  ChevronRight as LucideChevronRight,
  CircleAlert as LucideCircleAlert,
  CircleCheck as LucideCircleCheck,
  Cloud as LucideCloud,
  CloudOff as LucideCloudOff,
  CloudUpload as LucideCloudUpload,
  Copy as LucideCopy,
  Crop as LucideCrop,
  Database as LucideDatabase,
  Download as LucideDownload,
  ExternalLink as LucideExternalLink,
  Eye as LucideEye,
  EyeOff as LucideEyeOff,
  FileImage as LucideFileImage,
  FileLock as LucideFileLock,
  Film as LucideFilm,
  Frame as LucideFrame,
  HandHeart as LucideHandHeart,
  Images as LucideImages,
  Info as LucideInfo,
  Key as LucideKey,
  LayoutGrid as LucideLayoutGrid,
  Link as LucideLink,
  LoaderCircle as LucideLoaderCircle,
  LockKeyhole as LucideLockKeyhole,
  LogOut as LucideLogOut,
  Monitor as LucideMonitor,
  OctagonAlert as LucideOctagonAlert,
  QrCode as LucideQrCode,
  RefreshCw as LucideRefreshCw,
  RotateCcw as LucideRotateCcw,
  RotateCw as LucideRotateCw,
  Save as LucideSave,
  Send as LucideSend,
  Settings as LucideSettings,
  ShieldCheck as LucideShieldCheck,
  Trash2 as LucideTrash2,
  TriangleAlert as LucideTriangleAlert,
  Video as LucideVideo,
  VideoOff as LucideVideoOff,
  Wifi as LucideWifi,
  X as LucideX,
  ZoomIn as LucideZoomIn,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';

export type AppIconProps = LucideProps & {
  /** Phosphor-era weight name; Lucide uses one stroke for every icon. */
  weight?: string;
};

function createAppIcon(Icon: LucideIcon) {
  return function AppIcon({ size = 20, weight, strokeWidth = 1.75, ...props }: AppIconProps) {
    void weight;
    return <Icon {...props} size={size} strokeWidth={strokeWidth} />;
  };
}

export const Aperture = createAppIcon(LucideAperture);
export const ArrowClockwise = createAppIcon(LucideRotateCw);
export const ArrowCounterClockwise = createAppIcon(LucideRotateCcw);
export const ArrowDown = createAppIcon(LucideArrowDown);
export const ArrowRight = createAppIcon(LucideArrowRight);
export const ArrowLeft = createAppIcon(LucideArrowLeft);
export const ArrowSquareOut = createAppIcon(LucideExternalLink);
export const ArrowUp = createAppIcon(LucideArrowUp);
export const ArrowsClockwise = createAppIcon(LucideRefreshCw);
export const ArrowsLeftRight = createAppIcon(LucideArrowLeftRight);
export const CalendarBlank = createAppIcon(LucideCalendar);
export const Camera = createAppIcon(LucideCamera);
export const CaretLeft = createAppIcon(LucideChevronLeft);
export const CaretRight = createAppIcon(LucideChevronRight);
export const Check = createAppIcon(LucideCheck);
export const ChevronDown = createAppIcon(LucideChevronDown);
export const CheckCircle = createAppIcon(LucideCircleCheck);
export const Cloud = createAppIcon(LucideCloud);
export const CloudArrowUp = createAppIcon(LucideCloudUpload);
export const CloudSlash = createAppIcon(LucideCloudOff);
export const Copy = createAppIcon(LucideCopy);
export const Crop = createAppIcon(LucideCrop);
export const Database = createAppIcon(LucideDatabase);
export const Desktop = createAppIcon(LucideMonitor);
export const DownloadSimple = createAppIcon(LucideDownload);
export const Eye = createAppIcon(LucideEye);
export const EyeSlash = createAppIcon(LucideEyeOff);
export const FileLock = createAppIcon(LucideFileLock);
export const FilePng = createAppIcon(LucideFileImage);
export const FilmStrip = createAppIcon(LucideFilm);
export const FloppyDisk = createAppIcon(LucideSave);
export const FrameCorners = createAppIcon(LucideFrame);
export const Gear = createAppIcon(LucideSettings);
export const HandHeart = createAppIcon(LucideHandHeart);
export const Images = createAppIcon(LucideImages);
export const Info = createAppIcon(LucideInfo);
export const Key = createAppIcon(LucideKey);
export const LinkSimple = createAppIcon(LucideLink);
export const LockKey = createAppIcon(LucideLockKeyhole);
export const MagnifyingGlassPlus = createAppIcon(LucideZoomIn);
export const PaperPlaneTilt = createAppIcon(LucideSend);
export const QrCode = createAppIcon(LucideQrCode);
export const ShieldCheck = createAppIcon(LucideShieldCheck);
export const SignOut = createAppIcon(LucideLogOut);
export const SpinnerGap = createAppIcon(LucideLoaderCircle);
export const SquaresFour = createAppIcon(LucideLayoutGrid);
export const Trash = createAppIcon(LucideTrash2);
export const VideoCamera = createAppIcon(LucideVideo);
export const VideoCameraSlash = createAppIcon(LucideVideoOff);
export const Warning = createAppIcon(LucideTriangleAlert);
export const WarningCircle = createAppIcon(LucideCircleAlert);
export const WarningOctagon = createAppIcon(LucideOctagonAlert);
export const WifiHigh = createAppIcon(LucideWifi);
export const X = createAppIcon(LucideX);
