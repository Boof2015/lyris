import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps): React.ReactElement {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>
}

export const PlayIcon = (props: IconProps) => <Icon {...props}><path fill="currentColor" stroke="none" d="m7 4 9 6-9 6V4Z" /></Icon>
export const PauseIcon = (props: IconProps) => <Icon {...props}><path strokeWidth="2.4" d="M7 5v10M13 5v10" /></Icon>
export const FolderIcon = (props: IconProps) => <Icon {...props}><path d="M2.8 5.5h5l1.6 2h7.8v8.2H2.8z" /><path d="M2.8 7.5v-3h5l1.5 1.5" /></Icon>
export const AudioIcon = (props: IconProps) => <Icon {...props}><path d="M8 14.2V4l7-1.5v10" /><circle cx="5.5" cy="14.5" r="2.5" /><circle cx="12.5" cy="12.8" r="2.5" /></Icon>
export const ImportIcon = (props: IconProps) => <Icon {...props}><path d="M10 2.5v10M6.5 9 10 12.5 13.5 9" /><path d="M3.5 15.5h13" /></Icon>
export const ExportIcon = (props: IconProps) => <Icon {...props}><path d="M10 13V3M6.5 6.5 10 3l3.5 3.5" /><path d="M3.5 10.5v6h13v-6" /></Icon>
export const SaveIcon = (props: IconProps) => <Icon {...props}><path d="M3 3h12.5L17 4.5V17H3z" /><path d="M6 3v5h8V3M6 17v-6h8v6" /></Icon>
export const UndoIcon = (props: IconProps) => <Icon {...props}><path d="m7 6-4 4 4 4" /><path d="M4 10h7a5 5 0 0 1 5 5" /></Icon>
export const RedoIcon = (props: IconProps) => <Icon {...props}><path d="m13 6 4 4-4 4" /><path d="M16 10H9a5 5 0 0 0-5 5" /></Icon>
export const PlusIcon = (props: IconProps) => <Icon {...props}><path d="M10 3.5v13M3.5 10h13" /></Icon>
export const TrashIcon = (props: IconProps) => <Icon {...props}><path d="M4.5 6h11M8 3.5h4M6 6l.7 10h6.6L14 6" /></Icon>
export const UpIcon = (props: IconProps) => <Icon {...props}><path d="m5 12 5-5 5 5" /></Icon>
export const DownIcon = (props: IconProps) => <Icon {...props}><path d="m5 8 5 5 5-5" /></Icon>
export const LoopIcon = (props: IconProps) => <Icon {...props}><path d="M4 7h10l-2.5-2.5M16 13H6l2.5 2.5" /></Icon>
export const CheckIcon = (props: IconProps) => <Icon {...props}><path d="m4 10 4 4 8-9" /></Icon>
export const WarningIcon = (props: IconProps) => <Icon {...props}><path d="M10 2.5 18 17H2z" /><path d="M10 7v4M10 14h.01" /></Icon>
export const MoreIcon = (props: IconProps) => <Icon {...props}><circle cx="4" cy="10" r=".8" fill="currentColor" /><circle cx="10" cy="10" r=".8" fill="currentColor" /><circle cx="16" cy="10" r=".8" fill="currentColor" /></Icon>
export const GripIcon = (props: IconProps) => <Icon {...props}><circle cx="7" cy="5" r=".7" fill="currentColor" stroke="none" /><circle cx="13" cy="5" r=".7" fill="currentColor" stroke="none" /><circle cx="7" cy="10" r=".7" fill="currentColor" stroke="none" /><circle cx="13" cy="10" r=".7" fill="currentColor" stroke="none" /><circle cx="7" cy="15" r=".7" fill="currentColor" stroke="none" /><circle cx="13" cy="15" r=".7" fill="currentColor" stroke="none" /></Icon>
export const SettingsIcon = (props: IconProps) => <Icon {...props}><path d="M3 5h8M15 5h2M3 10h2M9 10h8M3 15h7M14 15h3" /><circle cx="13" cy="5" r="2" /><circle cx="7" cy="10" r="2" /><circle cx="12" cy="15" r="2" /></Icon>
