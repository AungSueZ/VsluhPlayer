// отправка медиа-клавиш в Windows, чтобы управлять чужими плеерами
// (SMTC умеет только читать, поэтому нажимаем кнопки за пользователя).
// Один живой процесс powershell со скриптом, команды шлём в stdin.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const VK = { playpause: 0xB3, next: 0xB0, prev: 0xB1, stop: 0xB2 };

const SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  'Add-Type -Namespace AungMK -Name Native -MemberDefinition @"',
  '[DllImport("user32.dll")]',
  'public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);',
  '"@',
  'while ($true) {',
  '  $line = [Console]::In.ReadLine()',
  '  if ($line -eq $null) { break }',
  '  $line = $line.Trim()',
  '  if ($line -eq "") { continue }',
  '  try {',
  '    $vk = [byte][Convert]::ToInt32($line, 16)',
  '    [AungMK.Native]::keybd_event($vk, 0, 1, [System.UIntPtr]::Zero)',
  '    [AungMK.Native]::keybd_event($vk, 0, 3, [System.UIntPtr]::Zero)',
  '  } catch { }',
  '}'
].join('\r\n');

class MediaKeys {
  constructor(dir) {
    this.file = path.join(dir, 'mediakeys.ps1');
    this.ps = null;
    this.failed = false;
  }

  _spawn() {
    if (this.ps || this.failed) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, SCRIPT, 'utf8');
      this.ps = spawn('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.file],
        { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });

      this.ps.on('error', () => { this.ps = null; this.failed = true; });
      this.ps.on('exit', () => { this.ps = null; });
      this.ps.stdin.on('error', () => {});
    } catch {
      this.ps = null;
      this.failed = true;
    }
  }

  // what: playpause | next | prev | stop
  send(what) {
    const vk = VK[what];
    if (!vk) return false;
    this._spawn();
    if (!this.ps) return false;
    try {
      this.ps.stdin.write(vk.toString(16) + '\r\n');
      return true;
    } catch {
      this.ps = null;
      return false;
    }
  }

  stop() {
    if (!this.ps) return;
    try { this.ps.stdin.end(); } catch {}
    try { this.ps.kill(); } catch {}
    this.ps = null;
  }
}

module.exports = { MediaKeys };
