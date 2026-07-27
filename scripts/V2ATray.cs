// V2A tray + global hotkey helper.
//
// Compiled at first run by server.js using the C# compiler that ships with
// the .NET Framework (csc.exe in %SystemRoot%\Microsoft.NET\Framework64), so
// there is nothing to install and no PowerShell script on disk.
//
// Talks to server.js over loopback only:
//   POST /api/tray/show | toggle-record | quit
//
// Usage: V2ATray.exe <port> <hotkey|None> <iconPath>
//        e.g. V2ATray.exe 8731 Ctrl+Alt+V C:\...\icon.ico

using System;
using System.Drawing;
using System.Globalization;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

namespace V2A
{
    // Hidden message-only window that receives WM_HOTKEY.
    internal sealed class HotkeyWindow : NativeWindow, IDisposable
    {
        private const int WM_HOTKEY = 0x0312;
        private const int HOTKEY_ID = 0xA2A;

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        public event EventHandler Pressed;
        private bool registered;

        public HotkeyWindow()
        {
            // HWND_MESSAGE parent → a message-only window, never rendered.
            CreateHandle(new CreateParams { Parent = (IntPtr)(-3) });
        }

        public bool Register(uint modifiers, uint virtualKey)
        {
            registered = RegisterHotKey(Handle, HOTKEY_ID, modifiers, virtualKey);
            return registered;
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_HOTKEY && Pressed != null) Pressed(this, EventArgs.Empty);
            base.WndProc(ref m);
        }

        public void Dispose()
        {
            if (registered) UnregisterHotKey(Handle, HOTKEY_ID);
            DestroyHandle();
        }
    }

    internal static class Program
    {
        private static string baseUrl;
        private static NotifyIcon notify;

        [STAThread]
        private static int Main(string[] args)
        {
            int port = args.Length > 0 ? int.Parse(args[0], CultureInfo.InvariantCulture) : 8731;
            string hotkey = args.Length > 1 ? args[1] : "Ctrl+Alt+V";
            string iconPath = args.Length > 2 ? args[2] : null;

            baseUrl = "http://127.0.0.1:" + port.ToString(CultureInfo.InvariantCulture);

            Application.EnableVisualStyles();

            notify = new NotifyIcon();
            notify.Icon = LoadIcon(iconPath);
            notify.Visible = true;
            notify.Text = hotkey == "None"
                ? "V2A - 语音转文字"
                : "V2A - 语音转文字 (" + hotkey + " 录音)";

            var menu = new ContextMenuStrip();

            var show = new ToolStripMenuItem("显示窗口");
            show.Font = new Font(menu.Font, FontStyle.Bold);
            show.Click += delegate { Send("show"); };
            menu.Items.Add(show);

            var record = new ToolStripMenuItem(
                hotkey == "None" ? "开始 / 停止录音" : "开始 / 停止录音   (" + hotkey + ")");
            record.Click += delegate { Send("toggle-record"); };
            menu.Items.Add(record);

            menu.Items.Add(new ToolStripSeparator());

            var quit = new ToolStripMenuItem("退出 V2A");
            quit.Click += delegate
            {
                Send("quit");
                notify.Visible = false;
                Application.Exit();
            };
            menu.Items.Add(quit);

            notify.ContextMenuStrip = menu;
            notify.DoubleClick += delegate { Send("show"); };

            HotkeyWindow hk = null;
            if (hotkey != "None")
            {
                uint mods, vk;
                if (TryParseHotkey(hotkey, out mods, out vk))
                {
                    hk = new HotkeyWindow();
                    hk.Pressed += delegate { Send("toggle-record"); };
                    if (!hk.Register(mods, vk))
                    {
                        // Another app already owns the combination — say so
                        // rather than failing silently.
                        notify.ShowBalloonTip(4000, "V2A",
                            "快捷键 " + hotkey + " 被其他程序占用，未能注册。可以在设置里换一个。",
                            ToolTipIcon.Warning);
                    }
                }
            }

            // If server.js goes away, don't leave an orphan icon in the tray.
            var watchdog = new Timer();
            watchdog.Interval = 5000;
            watchdog.Tick += delegate
            {
                if (!ServerAlive())
                {
                    notify.Visible = false;
                    Application.Exit();
                }
            };
            watchdog.Start();

            try
            {
                Application.Run();
            }
            finally
            {
                watchdog.Stop();
                if (hk != null) hk.Dispose();
                notify.Visible = false;
                notify.Dispose();
            }
            return 0;
        }

        private static Icon LoadIcon(string path)
        {
            try
            {
                if (!string.IsNullOrEmpty(path) && System.IO.File.Exists(path)) return new Icon(path);
            }
            catch { }
            return SystemIcons.Application;
        }

        private static void Send(string action)
        {
            try
            {
                using (var client = new WebClient())
                {
                    client.Encoding = Encoding.UTF8;
                    client.Headers[HttpRequestHeader.ContentType] = "application/json";
                    client.UploadString(baseUrl + "/api/tray/" + action, "POST", "{}");
                }
            }
            catch { /* server gone; nothing useful to do from the tray */ }
        }

        private static bool ServerAlive()
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(baseUrl + "/api/bootstrap");
                req.Timeout = 2000;
                req.Method = "GET";
                using (req.GetResponse()) { }
                return true;
            }
            catch (WebException e)
            {
                // A reachable server that answered with an error still counts as alive.
                return e.Response != null;
            }
            catch { return false; }
        }

        // "Ctrl+Alt+V" → MOD_CONTROL|MOD_ALT and VK_V.
        // MOD_ALT 1, MOD_CONTROL 2, MOD_SHIFT 4, MOD_WIN 8.
        private static bool TryParseHotkey(string text, out uint modifiers, out uint virtualKey)
        {
            modifiers = 0;
            virtualKey = 0;
            if (string.IsNullOrEmpty(text)) return false;

            string keyName = null;
            foreach (string rawPart in text.Split('+'))
            {
                string part = rawPart.Trim();
                if (part.Length == 0) continue;
                switch (part.ToLowerInvariant())
                {
                    case "ctrl":
                    case "control": modifiers |= 2; break;
                    case "alt": modifiers |= 1; break;
                    case "shift": modifiers |= 4; break;
                    case "win": modifiers |= 8; break;
                    default: keyName = part; break;
                }
            }
            if (keyName == null || modifiers == 0) return false;

            // Digits map to the Keys.D0-D9 members.
            if (keyName.Length == 1 && keyName[0] >= '0' && keyName[0] <= '9') keyName = "D" + keyName;

            try
            {
                virtualKey = (uint)(int)Enum.Parse(typeof(Keys), keyName, true);
                return virtualKey != 0;
            }
            catch { return false; }
        }
    }
}
