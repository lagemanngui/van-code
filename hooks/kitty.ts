// kitty (github.com/kovidgoyal/kitty): a terminal where Claude Code's file links are clickable,
// images show inline and Shift+Enter makes a new line. Never set as the system's default terminal.
export type Platform = 'macos' | 'windows' | 'wsl' | 'linux' | 'unknown'

// Where each install route leaves the app: Homebrew's cask and the official installer on macOS,
// the official installer on Linux.
export const KITTY_APPS = ['/Applications/kitty.app', '~/Applications/kitty.app', '~/.local/kitty.app']

// Written only when the person has no kitty.conf: theirs is never touched.
export function kittyConf(platform: Platform): string {
  const mac = platform === 'macos'
  return [
    '# Written by Jean-Claude Van Code (/van-code-setup kitty); edit freely.',
    ...(mac ? ['font_family      JetBrains Mono'] : []),
    'font_size        14.0',
    'remember_window_size  yes',
    'window_padding_width  8',
    'tab_bar_edge     top',
    'tab_bar_style    powerline',
    'scrollback_lines 10000',
    'copy_on_select   yes',
    'enable_audio_bell no',
    'enabled_layouts splits,stack',
    ...(mac
      ? [
          '',
          '# title bar kept, with its buttons ("titlebar-only" hides them on macOS)',
          'hide_window_decorations no',
          'macos_titlebar_color background',
          '# Option works as Alt in the shell (Alt+B, Alt+F); it no longer types ø or ©',
          'macos_option_as_alt   yes',
          'macos_quit_when_last_window_closed yes',
          '',
          '# cmd+t keeps the folder; cmd+d and cmd+shift+d split it (closing a split: ctrl+shift+w)',
          'map cmd+t new_tab_with_cwd',
          'map cmd+d launch --location=vsplit --cwd=current',
          'map cmd+shift+d launch --location=hsplit --cwd=current',
        ]
      : []),
    '',
  ].join('\n')
}

// A click (cmd/ctrl+click) on an image's name shows it inside kitty; any key closes it.
export const OPEN_ACTIONS = ['protocol file', 'mime image/*', 'action launch --type=overlay kitten icat --hold -- ${FILE_PATH}', ''].join('\n')

// The ls that makes file names clickable: GNU ls has --hyperlink, macOS's ls does not (gls is GNU's).
export const lsAlias = (platform: Platform) =>
  `[[ "$TERM" == "xterm-kitty" ]] && alias ls="${platform === 'macos' ? 'gls' : 'ls'} --hyperlink=auto --color=auto"`

// "Default terminal" on macOS is what opens shell scripts (.command, .sh) and ssh:// links;
// iTerm2's "Make default term" sets the same. Prints the app that had it, for the way back.
export const macDefaultScript = (bundle: string) =>
  [
    'ObjC.import("CoreServices")',
    'const was = ObjC.castRefToObject($.LSCopyDefaultRoleHandlerForContentType($("public.unix-executable"), $.kLSRolesShell)).js',
    `for (const t of ["public.unix-executable", "com.apple.terminal.shell-script"]) $.LSSetDefaultRoleHandlerForContentType($(t), $.kLSRolesShell, $("${bundle}"))`,
    `$.LSSetDefaultHandlerForURLScheme($("ssh"), $("${bundle}"))`,
    'was',
  ].join('; ')

// Linux has no single switch: the desktop entry kitty's docs install, xdg-terminal-exec's list
// (GNOME 47+, KDE 6) and GNOME's older key. Debian's alternatives need sudo: shown, not run.
export const LINUX_DEFAULT_SCRIPT = [
  'set -e',
  'mkdir -p ~/.local/share/applications ~/.config',
  'if [ -f ~/.local/kitty.app/share/applications/kitty.desktop ] && [ ! -f ~/.local/share/applications/kitty.desktop ]; then',
  '  cp ~/.local/kitty.app/share/applications/kitty.desktop ~/.local/share/applications/',
  '  sed -i "s|Icon=kitty|Icon=$HOME/.local/kitty.app/share/icons/hicolor/256x256/apps/kitty.png|g; s|Exec=kitty|Exec=$HOME/.local/kitty.app/bin/kitty|g" ~/.local/share/applications/kitty.desktop',
  'fi',
  'f=~/.config/xdg-terminals.list',
  '{ echo kitty.desktop; grep -vx kitty.desktop "$f" 2>/dev/null || true; } > "$f.new" && mv "$f.new" "$f"',
  'command -v gsettings >/dev/null && gsettings set org.gnome.desktop.default-applications.terminal exec kitty 2>/dev/null || true',
].join('\n')
