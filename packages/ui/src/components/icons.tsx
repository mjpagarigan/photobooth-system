import {
  ArrowClockwise20Regular,
  ArrowCounterclockwise20Regular,
  ArrowDown20Regular,
  ArrowDownload20Regular,
  ArrowExpand20Regular,
  ArrowLeft20Regular,
  ArrowRight20Regular,
  ArrowSync20Regular,
  ArrowUp20Regular,
  Calendar20Regular,
  Camera20Regular,
  Checkmark20Regular,
  CheckmarkCircle20Regular,
  ChevronLeft20Regular,
  ChevronRight20Regular,
  Cloud20Regular,
  CloudArrowUp20Regular,
  CloudOff20Regular,
  Copy20Regular,
  Crop20Regular,
  Database20Regular,
  Delete20Regular,
  Desktop20Regular,
  Dismiss20Regular,
  DocumentLock20Regular,
  ErrorCircle20Regular,
  Eye20Regular,
  EyeOff20Regular,
  Filmstrip20Regular,
  Frame20Regular,
  Grid20Regular,
  Heart20Regular,
  Image20Regular,
  ImageMultiple20Regular,
  Info20Regular,
  Key20Regular,
  Link20Regular,
  LockClosedKey20Regular,
  QrCode20Regular,
  Save20Regular,
  Search20Regular,
  Send20Regular,
  Settings20Regular,
  ShieldCheckmark20Regular,
  SignOut20Regular,
  SpinnerIos20Regular,
  Video20Regular,
  VideoOff20Regular,
  Warning20Regular,
  Wifi120Regular,
  type FluentIcon,
} from '@fluentui/react-icons';
import type { ComponentProps } from 'react';

export type AppIconProps = ComponentProps<FluentIcon> & {
  size?: number | string;
  /** Retained for source compatibility while migrating from Phosphor icons. */
  weight?: string;
};

function createAppIcon(Icon: FluentIcon) {
  return function AppIcon({ size = 20, weight, ...props }: AppIconProps) {
    void weight;
    return <Icon {...props} fontSize={size} />;
  };
}

export const Aperture = createAppIcon(Camera20Regular);
export const ArrowClockwise = createAppIcon(ArrowClockwise20Regular);
export const ArrowCounterClockwise = createAppIcon(ArrowCounterclockwise20Regular);
export const ArrowDown = createAppIcon(ArrowDown20Regular);
export const ArrowRight = createAppIcon(ArrowRight20Regular);
export const ArrowLeft = createAppIcon(ArrowLeft20Regular);
export const ArrowSquareOut = createAppIcon(ArrowExpand20Regular);
export const ArrowUp = createAppIcon(ArrowUp20Regular);
export const ArrowsClockwise = createAppIcon(ArrowSync20Regular);
export const ArrowsLeftRight = createAppIcon(ArrowSync20Regular);
export const CalendarBlank = createAppIcon(Calendar20Regular);
export const Camera = createAppIcon(Camera20Regular);
export const CaretLeft = createAppIcon(ChevronLeft20Regular);
export const CaretRight = createAppIcon(ChevronRight20Regular);
export const Check = createAppIcon(Checkmark20Regular);
export const CheckCircle = createAppIcon(CheckmarkCircle20Regular);
export const Cloud = createAppIcon(Cloud20Regular);
export const CloudArrowUp = createAppIcon(CloudArrowUp20Regular);
export const CloudSlash = createAppIcon(CloudOff20Regular);
export const Copy = createAppIcon(Copy20Regular);
export const Crop = createAppIcon(Crop20Regular);
export const Database = createAppIcon(Database20Regular);
export const Desktop = createAppIcon(Desktop20Regular);
export const DownloadSimple = createAppIcon(ArrowDownload20Regular);
export const Eye = createAppIcon(Eye20Regular);
export const EyeSlash = createAppIcon(EyeOff20Regular);
export const FileLock = createAppIcon(DocumentLock20Regular);
export const FilePng = createAppIcon(Image20Regular);
export const FilmStrip = createAppIcon(Filmstrip20Regular);
export const FloppyDisk = createAppIcon(Save20Regular);
export const FrameCorners = createAppIcon(Frame20Regular);
export const Gear = createAppIcon(Settings20Regular);
export const HandHeart = createAppIcon(Heart20Regular);
export const Images = createAppIcon(ImageMultiple20Regular);
export const Info = createAppIcon(Info20Regular);
export const Key = createAppIcon(Key20Regular);
export const LinkSimple = createAppIcon(Link20Regular);
export const LockKey = createAppIcon(LockClosedKey20Regular);
export const MagnifyingGlassPlus = createAppIcon(Search20Regular);
export const PaperPlaneTilt = createAppIcon(Send20Regular);
export const QrCode = createAppIcon(QrCode20Regular);
export const ShieldCheck = createAppIcon(ShieldCheckmark20Regular);
export const SignOut = createAppIcon(SignOut20Regular);
export const SpinnerGap = createAppIcon(SpinnerIos20Regular);
export const SquaresFour = createAppIcon(Grid20Regular);
export const Trash = createAppIcon(Delete20Regular);
export const VideoCamera = createAppIcon(Video20Regular);
export const VideoCameraSlash = createAppIcon(VideoOff20Regular);
export const Warning = createAppIcon(Warning20Regular);
export const WarningCircle = createAppIcon(ErrorCircle20Regular);
export const WarningOctagon = createAppIcon(Warning20Regular);
export const WifiHigh = createAppIcon(Wifi120Regular);
export const X = createAppIcon(Dismiss20Regular);
