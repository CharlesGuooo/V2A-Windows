// V2A tray helper — the native half of the Windows build.
//
// Owns everything that has to work while no window is open:
//   * the notification-area icon and its menu
//   * five global hotkeys (record / quick / deep / copy / clear)
//   * microphone capture (winmm waveIn, 16 kHz mono Int16, 1600-sample frames)
//   * the Soniox real-time WebSocket
//   * the floating recording bar and the transient toasts
//   * writing results to the clipboard
//
// Everything else — settings, API keys, AI cleanup, history — lives in
// server.js, which this talks to over loopback. server.js holds the session
// state, so the UI window is purely a view and closing it changes nothing.
//
// Compiled by server.js (source runs) or scripts/build-release.mjs (releases)
// with the .NET Framework compiler that ships with Windows.
//
// Usage: V2ATray.exe <port> <hotkeysJson|None> <iconPath> <lang: en|zh>

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace V2A
{
    // ================================================================== strings
    // The tray shows text on screen (menu, toasts, the recording bar) so it has
    // to follow the same language as the HTML UI. server.js resolves the
    // "system" setting and passes the answer in, so both halves always agree.
    internal static class L
    {
        private static bool zh;

        public static void Init(string lang) { zh = lang == "zh"; }

        public static string T(string en, string cn) { return zh ? cn : en; }
    }

    // ===================================================================== theme
    // Mirrors the dark-mode tokens in web/theme.css so the native surfaces and
    // the HTML UI look like one product.
    internal static class Theme
    {
        public static readonly Color Surface = ColorTranslator.FromHtml("#18181B");
        public static readonly Color Border = ColorTranslator.FromHtml("#3F3F46");
        public static readonly Color TextPrimary = ColorTranslator.FromHtml("#FAFAFA");
        public static readonly Color TextSecondary = ColorTranslator.FromHtml("#A1A1AA");
        public static readonly Color Accent = ColorTranslator.FromHtml("#818CF8");
        public static readonly Color Error = ColorTranslator.FromHtml("#F87171");
        public static readonly Color Success = ColorTranslator.FromHtml("#4ADE80");

        public static readonly Font Text = new Font("Segoe UI", 9.5f, FontStyle.Regular);
        public static readonly Font TextBold = new Font("Segoe UI", 9.5f, FontStyle.Bold);
        public static readonly Font Mono = new Font("Consolas", 9f, FontStyle.Regular);
    }

    // =========================================================== floating window
    // Base for the HUD and the toast: borderless, always on top, and — critically
    // — never takes focus. If these stole activation, dictating into another
    // application would move the caret out of it, which defeats the point.
    internal class OverlayWindow : Form
    {
        private const int WS_EX_TOPMOST = 0x00000008;
        private const int WS_EX_TOOLWINDOW = 0x00000080;
        private const int WS_EX_NOACTIVATE = 0x08000000;

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
                return cp;
            }
        }

        public OverlayWindow()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            BackColor = Theme.Surface;
            DoubleBuffered = true;
            TopMost = true;
        }

        // Bottom-right, above the taskbar.
        protected void PlaceBottomRight(int margin)
        {
            Rectangle wa = Screen.PrimaryScreen.WorkingArea;
            Location = new Point(wa.Right - Width - margin, wa.Bottom - Height - margin);
        }

        protected static void RoundCorners(Form f, int radius)
        {
            using (var path = new GraphicsPath())
            {
                int d = radius * 2;
                path.AddArc(0, 0, d, d, 180, 90);
                path.AddArc(f.Width - d - 1, 0, d, d, 270, 90);
                path.AddArc(f.Width - d - 1, f.Height - d - 1, d, d, 0, 90);
                path.AddArc(0, f.Height - d - 1, d, d, 90, 90);
                path.CloseFigure();
                f.Region = new Region(path);
            }
        }
    }

    // ================================================================ recording HUD
    internal sealed class RecordingHud : OverlayWindow
    {
        // Qualified: System.Threading.Timer is also in scope here.
        private readonly System.Windows.Forms.Timer ticker = new System.Windows.Forms.Timer();
        private DateTime startedAt;
        private double level;          // 0..1, smoothed
        private bool blinkOn = true;
        private int blinkCounter;

        public RecordingHud()
        {
            Width = 188;
            Height = 44;
            ticker.Interval = 100;
            ticker.Tick += delegate
            {
                blinkCounter++;
                if (blinkCounter % 7 == 0) blinkOn = !blinkOn;
                level *= 0.75;          // decay when no new audio arrives
                Invalidate();
            };
        }

        public void Begin()
        {
            startedAt = DateTime.UtcNow;
            level = 0;
            blinkOn = true;
            PlaceBottomRight(16);
            RoundCorners(this, 10);
            Show();
            ticker.Start();
        }

        public void End()
        {
            ticker.Stop();
            Hide();
        }

        public void ReportLevel(double rms)
        {
            // Speech RMS sits well below 1.0; scale so normal talking fills the bar.
            double scaled = Math.Min(1.0, rms * 8.0);
            if (scaled > level) level = scaled; else level = level * 0.7 + scaled * 0.3;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Theme.Surface);

            using (var pen = new Pen(Theme.Border))
                g.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);

            // Blinking record dot.
            if (blinkOn)
                using (var b = new SolidBrush(Theme.Error))
                    g.FillEllipse(b, 14, Height / 2 - 4, 8, 8);

            TimeSpan elapsed = DateTime.UtcNow - startedAt;
            string time = string.Format(CultureInfo.InvariantCulture, "{0}:{1:00}",
                                        (int)elapsed.TotalMinutes, elapsed.Seconds);

            using (var b = new SolidBrush(Theme.TextPrimary))
                g.DrawString(L.T("Recording", "录音中"), Theme.TextBold, b, 30, Height / 2 - 9);
            using (var b = new SolidBrush(Theme.TextSecondary))
                g.DrawString(time, Theme.Mono, b, 76, Height / 2 - 8);

            // Volume meter: eight segments that light up with the input level.
            const int segs = 8, segW = 5, gap = 3;
            int x0 = 122, y0 = Height / 2 - 6;
            int lit = (int)Math.Round(level * segs);
            for (int i = 0; i < segs; i++)
            {
                int h = 4 + i;
                Color c = i < lit ? Theme.Accent : Theme.Border;
                using (var b = new SolidBrush(c))
                    g.FillRectangle(b, x0 + i * (segW + gap), y0 + (12 - h), segW, h);
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) ticker.Dispose();
            base.Dispose(disposing);
        }
    }

    // ======================================================================= toast
    internal sealed class ToastWindow : OverlayWindow
    {
        private readonly System.Windows.Forms.Timer life = new System.Windows.Forms.Timer();
        private string message = "";
        private Color accent = Theme.Accent;
        private int ticks;

        public ToastWindow()
        {
            Height = 40;
            life.Interval = 60;
            life.Tick += delegate
            {
                ticks++;
                if (ticks > 26) Opacity -= 0.12;      // ~1.6 s visible, then fade
                if (Opacity <= 0.02) { life.Stop(); Hide(); }
            };
        }

        public void ShowMessage(string text, Color color)
        {
            message = text ?? "";
            accent = color;
            using (Graphics g = CreateGraphics())
                Width = Math.Max(150, Math.Min(420, (int)g.MeasureString(message, Theme.Text).Width + 54));

            ticks = 0;
            Opacity = 1;
            // Sits above the HUD so both can be visible at once.
            Rectangle wa = Screen.PrimaryScreen.WorkingArea;
            Location = new Point(wa.Right - Width - 16, wa.Bottom - Height - 72);
            RoundCorners(this, 8);
            Show();
            life.Start();
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Theme.Surface);
            using (var pen = new Pen(Theme.Border))
                g.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
            using (var b = new SolidBrush(accent))
                g.FillRectangle(b, 0, 0, 3, Height);
            using (var b = new SolidBrush(Theme.TextPrimary))
                g.DrawString(message, Theme.Text, b, 16, Height / 2 - 9);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) life.Dispose();
            base.Dispose(disposing);
        }
    }

    // ================================================================ mic capture
    // waveIn at 16 kHz / mono / 16-bit, delivering 1600-sample (100 ms) frames —
    // the exact framing Soniox wants, and the same as MicRecorder.swift.
    internal sealed class MicCapture : IDisposable
    {
        private const int CALLBACK_FUNCTION = 0x00030000;
        private const int MM_WIM_DATA = 0x3C0;
        private const int WAVE_MAPPER = -1;
        private const int FRAME_BYTES = 3200;
        private const int BUFFER_COUNT = 8;

        [StructLayout(LayoutKind.Sequential)]
        private class WaveFormatEx
        {
            public short wFormatTag = 1;      // WAVE_FORMAT_PCM
            public short nChannels = 1;
            public int nSamplesPerSec = 16000;
            public int nAvgBytesPerSec = 32000;
            public short nBlockAlign = 2;
            public short wBitsPerSample = 16;
            public short cbSize = 0;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct WaveHdr
        {
            public IntPtr lpData;
            public uint dwBufferLength;
            public uint dwBytesRecorded;
            public IntPtr dwUser;
            public uint dwFlags;
            public uint dwLoops;
            public IntPtr lpNext;
            public IntPtr reserved;
        }

        private delegate void WaveInProc(IntPtr hWaveIn, uint msg, IntPtr inst, ref WaveHdr hdr, IntPtr p2);

        [DllImport("winmm.dll")] private static extern int waveInGetNumDevs();
        [DllImport("winmm.dll")] private static extern int waveInOpen(out IntPtr h, int dev, WaveFormatEx fmt, WaveInProc cb, IntPtr inst, int flags);
        [DllImport("winmm.dll")] private static extern int waveInPrepareHeader(IntPtr h, ref WaveHdr hdr, int size);
        [DllImport("winmm.dll")] private static extern int waveInUnprepareHeader(IntPtr h, ref WaveHdr hdr, int size);
        [DllImport("winmm.dll")] private static extern int waveInAddBuffer(IntPtr h, ref WaveHdr hdr, int size);
        [DllImport("winmm.dll")] private static extern int waveInStart(IntPtr h);
        [DllImport("winmm.dll")] private static extern int waveInStop(IntPtr h);
        [DllImport("winmm.dll")] private static extern int waveInReset(IntPtr h);
        [DllImport("winmm.dll")] private static extern int waveInClose(IntPtr h);

        private IntPtr handle;
        private WaveInProc callback;          // must stay rooted or the GC collects it
        private WaveHdr[] headers;
        private IntPtr[] buffers;
        private volatile bool running;
        private readonly int hdrSize = Marshal.SizeOf(typeof(WaveHdr));

        // frame: raw 16-bit LE PCM. rms: 0..1 loudness of that frame.
        public Action<byte[], double> OnFrame;

        public static bool HasDevice { get { return waveInGetNumDevs() > 0; } }

        public bool Start()
        {
            if (running) return true;
            if (!HasDevice) return false;

            callback = OnWaveIn;
            if (waveInOpen(out handle, WAVE_MAPPER, new WaveFormatEx(), callback, IntPtr.Zero, CALLBACK_FUNCTION) != 0)
                return false;

            headers = new WaveHdr[BUFFER_COUNT];
            buffers = new IntPtr[BUFFER_COUNT];
            running = true;
            for (int i = 0; i < BUFFER_COUNT; i++)
            {
                buffers[i] = Marshal.AllocHGlobal(FRAME_BYTES);
                headers[i] = new WaveHdr { lpData = buffers[i], dwBufferLength = FRAME_BYTES };
                waveInPrepareHeader(handle, ref headers[i], hdrSize);
                waveInAddBuffer(handle, ref headers[i], hdrSize);
            }
            waveInStart(handle);
            return true;
        }

        private void OnWaveIn(IntPtr h, uint msg, IntPtr inst, ref WaveHdr hdr, IntPtr p2)
        {
            if (msg != MM_WIM_DATA || !running) return;

            int n = (int)hdr.dwBytesRecorded;
            if (n > 0)
            {
                var pcm = new byte[n];
                Marshal.Copy(hdr.lpData, pcm, 0, n);

                double sum = 0;
                for (int i = 0; i + 1 < n; i += 2)
                {
                    short s = (short)(pcm[i] | (pcm[i + 1] << 8));
                    double v = s / 32768.0;
                    sum += v * v;
                }
                double rms = Math.Sqrt(sum / (n / 2.0));

                var sink = OnFrame;
                if (sink != null) { try { sink(pcm, rms); } catch { } }
            }

            if (running) waveInAddBuffer(h, ref hdr, hdrSize);
        }

        public void Stop()
        {
            if (!running) return;
            running = false;
            try
            {
                waveInStop(handle);
                waveInReset(handle);
                for (int i = 0; i < BUFFER_COUNT; i++)
                {
                    try { waveInUnprepareHeader(handle, ref headers[i], hdrSize); } catch { }
                    if (buffers[i] != IntPtr.Zero) { Marshal.FreeHGlobal(buffers[i]); buffers[i] = IntPtr.Zero; }
                }
                waveInClose(handle);
            }
            catch { }
            handle = IntPtr.Zero;
        }

        public void Dispose() { Stop(); }
    }

    // ============================================================= soniox session
    // Port of web/soniox.js: same config payload, same token-merge rule (finals
    // accumulate, interims are a rolling tail) and the same marker filtering.
    internal sealed class SonioxSession
    {
        private const string Endpoint = "wss://stt-rt.soniox.com/transcribe-websocket";

        private ClientWebSocket socket;
        private CancellationTokenSource cts;
        private readonly StringBuilder finalText = new StringBuilder();
        private volatile bool closedByUs;

        public Action<string> OnText;         // full transcript so far
        public Action<string> OnFailure;      // human-readable message

        public string Transcript { get; private set; }

        public bool Start(string apiKey, string[] languages, string[] hotwords)
        {
            Transcript = "";
            closedByUs = false;
            cts = new CancellationTokenSource();
            socket = new ClientWebSocket();

            try
            {
                if (!socket.ConnectAsync(new Uri(Endpoint), cts.Token).Wait(12000))
                {
                    Fail(L.T("Timed out connecting to Soniox", "连接 Soniox 超时"));
                    return false;
                }
            }
            catch (Exception e)
            {
                Fail(L.T("Could not connect to Soniox: ", "连接 Soniox 失败：") + e.GetBaseException().Message);
                return false;
            }

            var config = new Dictionary<string, object>
            {
                { "api_key", apiKey },
                { "model", "stt-rt-v5" },
                { "audio_format", "s16le" },
                { "sample_rate", 16000 },
                { "num_channels", 1 },
                { "enable_endpoint_detection", true },
            };
            if (languages != null && languages.Length > 0)
            {
                config["language_hints"] = languages;
                config["language_hints_strict"] = true;
            }
            if (hotwords != null && hotwords.Length > 0)
                config["context"] = new Dictionary<string, object> { { "terms", hotwords } };

            try
            {
                byte[] payload = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(config));
                socket.SendAsync(new ArraySegment<byte>(payload), WebSocketMessageType.Text, true, cts.Token).Wait();
            }
            catch (Exception e)
            {
                Fail(L.T("Could not send the Soniox config: ", "发送 Soniox 配置失败：") + e.GetBaseException().Message);
                return false;
            }

            Task.Factory.StartNew(ReceiveLoop, TaskCreationOptions.LongRunning);
            return true;
        }

        public void SendAudio(byte[] pcm)
        {
            var ws = socket;
            if (ws == null || ws.State != WebSocketState.Open) return;
            try { ws.SendAsync(new ArraySegment<byte>(pcm), WebSocketMessageType.Binary, true, cts.Token).Wait(2000); }
            catch { }
        }

        // Signals end-of-stream and gives the server a moment to flush finals.
        public void Stop()
        {
            var ws = socket;
            if (ws == null) return;
            closedByUs = true;
            try
            {
                if (ws.State == WebSocketState.Open)
                    ws.SendAsync(new ArraySegment<byte>(new byte[0]), WebSocketMessageType.Text, true, CancellationToken.None).Wait(2000);
            }
            catch { }
            Thread.Sleep(600);
            try { ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None).Wait(2000); } catch { }
            try { cts.Cancel(); } catch { }
            socket = null;
        }

        private void Fail(string message)
        {
            var h = OnFailure;
            if (h != null) h(message);
        }

        private void ReceiveLoop()
        {
            var buffer = new byte[32768];
            var chunk = new StringBuilder();
            try
            {
                while (socket != null && socket.State == WebSocketState.Open)
                {
                    var res = socket.ReceiveAsync(new ArraySegment<byte>(buffer), cts.Token).Result;
                    if (res.MessageType == WebSocketMessageType.Close) break;
                    chunk.Append(Encoding.UTF8.GetString(buffer, 0, res.Count));
                    if (!res.EndOfMessage) continue;
                    string message = chunk.ToString();
                    chunk.Length = 0;
                    if (!HandleMessage(message)) break;
                }
            }
            catch
            {
                if (!closedByUs) Fail(L.T("Soniox connection dropped", "Soniox 连接中断"));
            }
        }

        // Returns false when the session should stop.
        private bool HandleMessage(string raw)
        {
            Dictionary<string, object> obj;
            try { obj = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(raw); }
            catch { return true; }
            if (obj == null) return true;

            if (obj.ContainsKey("error_code") || obj.ContainsKey("error_message"))
            {
                object msg;
                obj.TryGetValue("error_message", out msg);
                string text = msg == null ? "" : msg.ToString();
                closedByUs = true;
                Fail(ClassifySonioxError(text));
                return false;
            }

            object tokensObj;
            if (!obj.TryGetValue("tokens", out tokensObj)) return true;
            var tokens = tokensObj as System.Collections.ArrayList;
            if (tokens == null || tokens.Count == 0) return true;

            var interim = new StringBuilder();
            foreach (var item in tokens)
            {
                var tok = item as Dictionary<string, object>;
                if (tok == null) continue;
                object textObj;
                if (!tok.TryGetValue("text", out textObj)) continue;
                string text = textObj as string;
                if (string.IsNullOrEmpty(text)) continue;
                // enable_endpoint_detection emits literal marker tokens; they are
                // protocol, not speech.
                if (text == "<end>" || text == "<fin>") continue;

                object isFinal;
                bool final = tok.TryGetValue("is_final", out isFinal) && isFinal is bool && (bool)isFinal;
                if (final) finalText.Append(text); else interim.Append(text);
            }

            Transcript = (finalText.ToString() + interim.ToString()).Trim();
            var h = OnText;
            if (h != null) h(Transcript);
            return true;
        }

        // Mirrors the branches in web/errors.js so both paths say the same thing.
        private static string ClassifySonioxError(string raw)
        {
            string s = (raw ?? "").ToLowerInvariant();
            if (s.Contains("unauthor") || s.Contains("invalid") || s.Contains("api key") || s.Contains("authentication"))
                return L.T("The Soniox API key is invalid or expired", "Soniox 的 API key 无效或已失效");
            if (s.Contains("quota") || s.Contains("balance") || s.Contains("limit") || s.Contains("exceeded") || s.Contains("insufficient"))
                return L.T("Soniox is out of balance / quota", "Soniox 余额 / 额度不足");
            return string.IsNullOrEmpty(raw) ? L.T("Soniox disconnected", "Soniox 连接断开") : "Soniox 出错：" + raw;
        }
    }

    // ================================================================= server api
    internal sealed class ServerApi
    {
        private readonly string baseUrl;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();

        public ServerApi(int port)
        {
            baseUrl = "http://127.0.0.1:" + port.ToString(CultureInfo.InvariantCulture);
            json.MaxJsonLength = 32 * 1024 * 1024;
        }

        public string BaseUrl { get { return baseUrl; } }

        public Dictionary<string, object> Request(string method, string path, object body)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(baseUrl + path);
                req.Method = method;
                req.Timeout = 120000;           // AI cleanup can legitimately take a while
                req.ReadWriteTimeout = 120000;
                if (body != null)
                {
                    req.ContentType = "application/json";
                    byte[] payload = Encoding.UTF8.GetBytes(json.Serialize(body));
                    req.ContentLength = payload.Length;
                    using (var s = req.GetRequestStream()) s.Write(payload, 0, payload.Length);
                }
                using (var resp = req.GetResponse())
                using (var reader = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                {
                    string text = reader.ReadToEnd();
                    if (string.IsNullOrEmpty(text)) return new Dictionary<string, object>();
                    return json.Deserialize<Dictionary<string, object>>(text) ?? new Dictionary<string, object>();
                }
            }
            catch
            {
                return null;
            }
        }

        public bool Alive() { return Request("GET", "/api/bootstrap", null) != null; }

        public static string Str(Dictionary<string, object> d, string key)
        {
            object v;
            if (d != null && d.TryGetValue(key, out v) && v != null) return v.ToString();
            return null;
        }

        public static bool Bool(Dictionary<string, object> d, string key)
        {
            object v;
            return d != null && d.TryGetValue(key, out v) && v is bool && (bool)v;
        }

        public static string[] StrArray(Dictionary<string, object> d, string key)
        {
            object v;
            if (d == null || !d.TryGetValue(key, out v)) return new string[0];
            var list = v as System.Collections.ArrayList;
            if (list == null) return new string[0];
            var outp = new List<string>();
            foreach (var item in list) if (item != null) outp.Add(item.ToString());
            return outp.ToArray();
        }
    }

    // ==================================================================== hotkeys
    internal sealed class HotkeyWindow : NativeWindow, IDisposable
    {
        private const int WM_HOTKEY = 0x0312;

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        private readonly Dictionary<int, Action> actions = new Dictionary<int, Action>();
        private int nextId = 0xA00;

        public HotkeyWindow() { CreateHandle(new CreateParams { Parent = (IntPtr)(-3) }); }

        public bool Register(string combo, Action handler)
        {
            uint mods, vk;
            if (!TryParseHotkey(combo, out mods, out vk)) return false;
            int id = nextId++;
            if (!RegisterHotKey(Handle, id, mods, vk)) return false;
            actions[id] = handler;
            return true;
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_HOTKEY)
            {
                Action a;
                if (actions.TryGetValue(m.WParam.ToInt32(), out a) && a != null)
                {
                    try { a(); } catch { }
                }
            }
            base.WndProc(ref m);
        }

        public void Dispose()
        {
            foreach (var id in actions.Keys) { try { UnregisterHotKey(Handle, id); } catch { } }
            actions.Clear();
            DestroyHandle();
        }

        // "Ctrl+Shift+R" -> MOD_CONTROL|MOD_SHIFT and VK_R.
        // MOD_ALT 1, MOD_CONTROL 2, MOD_SHIFT 4, MOD_WIN 8.
        public static bool TryParseHotkey(string text, out uint modifiers, out uint virtualKey)
        {
            modifiers = 0;
            virtualKey = 0;
            if (string.IsNullOrEmpty(text) || text == "None") return false;

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

            if (keyName.Length == 1 && keyName[0] >= '0' && keyName[0] <= '9') keyName = "D" + keyName;

            // The settings UI writes the spelling users recognise; translate the
            // few that differ from the System.Windows.Forms.Keys member names.
            switch (keyName.ToLowerInvariant())
            {
                case "backspace": keyName = "Back"; break;
                case "esc": keyName = "Escape"; break;
                case "del": keyName = "Delete"; break;
                case "ins": keyName = "Insert"; break;
            }

            try
            {
                virtualKey = (uint)(int)Enum.Parse(typeof(Keys), keyName, true);
                return virtualKey != 0;
            }
            catch { return false; }
        }
    }

    // ==================================================================== program
    internal static class Program
    {
        private static ServerApi api;
        private static NotifyIcon notify;
        private static RecordingHud hud;
        private static ToastWindow toast;
        private static HotkeyWindow hotkeys;
        private static Control marshal;          // for hopping back to the UI thread

        private static MicCapture mic;
        private static SonioxSession soniox;
        private static volatile bool recording;
        private static volatile bool busy;       // a start/stop is in flight
        private static DateTime lastPush = DateTime.MinValue;

        [STAThread]
        private static int Main(string[] args)
        {
            int port = args.Length > 0 ? ParseInt(args[0], 8731) : 8731;
            string hotkeysJson = args.Length > 1 ? args[1] : "None";
            string iconPath = args.Length > 2 ? args[2] : null;
            // server.js has already resolved the "system" setting for us.
            L.Init(args.Length > 3 ? args[3] : "en");

            // .NET Framework does not always negotiate TLS 1.2 by default, and
            // Soniox requires it.
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            ServicePointManager.DefaultConnectionLimit = 16;

            api = new ServerApi(port);

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            marshal = new Control();
            marshal.CreateControl();
            IntPtr forceHandle = marshal.Handle;   // realise the handle on this thread

            hud = new RecordingHud();
            toast = new ToastWindow();

            BuildTray(iconPath, hotkeysJson);
            RegisterHotkeys(hotkeysJson);
            StartEventStream();
            StartWatchdog();

            try
            {
                Application.Run();
            }
            finally
            {
                StopRecording(true);
                if (hotkeys != null) hotkeys.Dispose();
                notify.Visible = false;
                notify.Dispose();
            }
            return 0;
        }

        private static int ParseInt(string s, int fallback)
        {
            int v;
            return int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out v) ? v : fallback;
        }

        private static void OnUi(Action a)
        {
            if (marshal == null || !marshal.IsHandleCreated) return;
            try
            {
                if (marshal.InvokeRequired) marshal.BeginInvoke(a);
                else a();
            }
            catch { }
        }

        private static void Toast(string text, Color color)
        {
            OnUi(delegate { toast.ShowMessage(text, color); });
        }

        // ------------------------------------------------------------- tray

        private static void BuildTray(string iconPath, string hotkeysJson)
        {
            var keys = ParseHotkeyMap(hotkeysJson);
            string recordKey;
            keys.TryGetValue("record", out recordKey);

            notify = new NotifyIcon();
            notify.Icon = LoadIcon(iconPath);
            notify.Visible = true;
            notify.Text = string.IsNullOrEmpty(recordKey)
                ? L.T("V2A - Voice to Agent", "V2A - 语音转文字")
                : L.T("V2A - Voice to Agent (" + recordKey + " to record)",
                       "V2A - 语音转文字 (" + recordKey + " 录音)");

            var menu = new ContextMenuStrip();

            var show = new ToolStripMenuItem(L.T("Show window", "显示窗口"));
            show.Font = new Font(menu.Font, FontStyle.Bold);
            show.Click += delegate { api.Request("POST", "/api/tray/show", new Dictionary<string, object>()); };
            menu.Items.Add(show);

            var rec = new ToolStripMenuItem(string.IsNullOrEmpty(recordKey)
                ? L.T("Start / stop recording", "开始 / 停止录音") : "开始 / 停止录音   (" + recordKey + ")");
            rec.Click += delegate { ToggleRecording(); };
            menu.Items.Add(rec);

            menu.Items.Add(new ToolStripSeparator());

            var quit = new ToolStripMenuItem(L.T("Quit V2A", "退出 V2A"));
            quit.Click += delegate
            {
                StopRecording(true);
                api.Request("POST", "/api/tray/quit", new Dictionary<string, object>());
                notify.Visible = false;
                Application.Exit();
            };
            menu.Items.Add(quit);

            notify.ContextMenuStrip = menu;
            notify.DoubleClick += delegate { api.Request("POST", "/api/tray/show", new Dictionary<string, object>()); };
        }

        private static Icon LoadIcon(string path)
        {
            try { if (!string.IsNullOrEmpty(path) && File.Exists(path)) return new Icon(path); }
            catch { }
            return SystemIcons.Application;
        }

        private static Dictionary<string, string> ParseHotkeyMap(string raw)
        {
            var map = new Dictionary<string, string>();
            if (string.IsNullOrEmpty(raw) || raw == "None") return map;
            try
            {
                var parsed = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(raw);
                if (parsed != null)
                    foreach (var kv in parsed)
                        if (kv.Value != null) map[kv.Key] = kv.Value.ToString();
            }
            catch
            {
                // Older callers passed a bare combination for the record action.
                map["record"] = raw;
            }
            return map;
        }

        private static void RegisterHotkeys(string hotkeysJson)
        {
            var map = ParseHotkeyMap(hotkeysJson);
            if (map.Count == 0) return;

            hotkeys = new HotkeyWindow();
            var failed = new List<string>();

            Action<string, Action> bind = delegate (string action, Action handler)
            {
                string combo;
                if (!map.TryGetValue(action, out combo) || string.IsNullOrEmpty(combo)) return;
                if (!hotkeys.Register(combo, handler)) failed.Add(combo);
            };

            bind("record", ToggleRecording);
            bind("light", delegate { RunCleanup("light"); });
            bind("deep", delegate { RunCleanup("deep"); });
            bind("copy", CopyResult);
            bind("clear", ClearAll);

            if (failed.Count > 0)
            {
                notify.ShowBalloonTip(5000, "V2A",
                    L.T("These hotkeys are already taken by another program and could not be registered:\n",
                        "这些快捷键被其他程序占用，没能注册：\n")
                    + string.Join(L.T(", ", "、"), failed.ToArray())
                    + L.T("\nYou can pick different ones in Settings.", "\n可以在设置里换一个组合。"),
                    ToolTipIcon.Warning);
            }
        }

        // -------------------------------------------------------- recording

        private static void ToggleRecording()
        {
            if (busy) return;
            if (recording) StopRecording(false); else StartRecording();
        }

        private static void StartRecording()
        {
            if (recording || busy) return;
            busy = true;

            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    var config = api.Request("GET", "/api/session/config", null);
                    if (config == null) { Toast(L.T("V2A background service is not responding", "V2A 后台没有响应"), Theme.Error); return; }

                    string key = ServerApi.Str(config, "sonioxKey");
                    if (string.IsNullOrEmpty(key)) { Toast(L.T("No Soniox API key configured yet", "还没有配置 Soniox API key"), Theme.Error); return; }

                    if (!MicCapture.HasDevice) { Toast(L.T("No microphone found", "找不到麦克风"), Theme.Error); return; }

                    soniox = new SonioxSession();
                    soniox.OnText = PushTranscript;
                    soniox.OnFailure = delegate (string message)
                    {
                        Toast(message, Theme.Error);
                        StopRecording(true);
                    };

                    if (!soniox.Start(key, ServerApi.StrArray(config, "languages"), ServerApi.StrArray(config, "hotwords")))
                        return;   // OnFailure already reported

                    mic = new MicCapture();
                    mic.OnFrame = delegate (byte[] pcm, double rms)
                    {
                        soniox.SendAudio(pcm);
                        OnUi(delegate { hud.ReportLevel(rms); });
                    };

                    if (!mic.Start())
                    {
                        Toast(L.T("Could not open the microphone - another app may be using it", "麦克风打不开，可能被其他程序占用"), Theme.Error);
                        soniox.Stop();
                        soniox = null;
                        return;
                    }

                    recording = true;
                    api.Request("POST", "/api/session/recording", new Dictionary<string, object> { { "recording", true } });
                    OnUi(delegate { hud.Begin(); });
                }
                finally { busy = false; }
            });
        }

        private static void StopRecording(bool silent)
        {
            if (!recording) return;
            recording = false;
            busy = true;

            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    if (mic != null) { mic.Stop(); mic.Dispose(); mic = null; }

                    string text = "";
                    if (soniox != null)
                    {
                        soniox.Stop();
                        text = soniox.Transcript ?? "";
                        soniox = null;
                    }

                    OnUi(delegate { hud.End(); });

                    var res = api.Request("POST", "/api/session/commit",
                        new Dictionary<string, object> { { "text", text } });

                    if (silent) return;
                    if (string.IsNullOrEmpty(text.Trim()))
                        Toast(L.T("Didn't catch any audio", "没听到声音"), Theme.Error);
                    else
                        Toast(L.T("Stopped - " + text.Trim().Length + " chars",
                                  "已停止 · " + text.Trim().Length + " 字"), Theme.Success);
                }
                finally { busy = false; }
            });
        }

        // Soniox updates arrive far faster than the UI needs; throttle the pushes
        // so a long session doesn't hammer the loopback server.
        private static void PushTranscript(string text)
        {
            DateTime now = DateTime.UtcNow;
            if ((now - lastPush).TotalMilliseconds < 150) return;
            lastPush = now;
            ThreadPool.QueueUserWorkItem(delegate
            {
                api.Request("POST", "/api/session/transcript",
                    new Dictionary<string, object> { { "text", text } });
            });
        }

        // ---------------------------------------------------------- actions

        private static void RunCleanup(string kind)
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                Toast(kind == "deep" ? L.T("Deep cleanup...", "深度整理中…")
                                     : L.T("Quick cleanup...", "轻度整理中…"), Theme.Accent);

                var res = api.Request("POST", "/api/session/cleanup",
                    new Dictionary<string, object> { { "kind", kind } });

                if (res == null) { Toast(L.T("V2A background service is not responding", "V2A 后台没有响应"), Theme.Error); return; }

                if (!ServerApi.Bool(res, "ok"))
                {
                    Toast(ServerApi.Str(res, "message") ?? L.T("Cleanup failed", "整理失败"), Theme.Error);
                    return;
                }

                string text = ServerApi.Str(res, "text") ?? "";
                if (ServerApi.Bool(res, "copied"))
                {
                    SetClipboard(text);
                    Toast(L.T("Done - " + text.Length + " chars copied",
                              "整理完成 · 已复制 " + text.Length + " 字"), Theme.Success);
                }
                else
                {
                    Toast(L.T("Done - " + text.Length + " chars", "整理完成 · " + text.Length + " 字"), Theme.Success);
                }
            });
        }

        private static void CopyResult()
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                var res = api.Request("GET", "/api/session/processed", null);
                if (res == null) { Toast(L.T("V2A background service is not responding", "V2A 后台没有响应"), Theme.Error); return; }
                string text = ServerApi.Str(res, "text") ?? "";
                if (text.Length == 0) { Toast(L.T("No cleaned-up text yet", "还没有整理结果"), Theme.Error); return; }
                SetClipboard(text);
                Toast(L.T("Copied " + text.Length + " chars", "已复制 " + text.Length + " 字"), Theme.Success);
            });
        }

        private static void ClearAll()
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                if (recording) { Toast(L.T("Still recording - stop before clearing", "正在录音，先停止再清空"), Theme.Error); return; }
                var res = api.Request("POST", "/api/session/clear", new Dictionary<string, object>());
                if (res == null) { Toast(L.T("V2A background service is not responding", "V2A 后台没有响应"), Theme.Error); return; }
                Toast(ServerApi.Bool(res, "cleared") ? L.T("Cleared", "已清空") : L.T("Nothing to clear", "没有内容可清空"),
                      ServerApi.Bool(res, "cleared") ? Theme.Success : Theme.Accent);
            });
        }

        // Clipboard needs an STA thread; the UI thread is one.
        private static void SetClipboard(string text)
        {
            if (string.IsNullOrEmpty(text)) return;
            OnUi(delegate
            {
                for (int attempt = 0; attempt < 3; attempt++)
                {
                    // Another process can hold the clipboard open momentarily.
                    try { Clipboard.SetText(text); return; }
                    catch { Thread.Sleep(80); }
                }
            });
        }

        // ------------------------------------------------------ server link

        // Long-lived SSE connection: how the UI window asks the tray to do things.
        private static void StartEventStream()
        {
            var thread = new Thread(delegate ()
            {
                while (true)
                {
                    try
                    {
                        var req = (HttpWebRequest)WebRequest.Create(api.BaseUrl + "/api/events");
                        req.Timeout = 10000;
                        req.ReadWriteTimeout = Timeout.Infinite;
                        using (var resp = req.GetResponse())
                        using (var reader = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                        {
                            string line;
                            while ((line = reader.ReadLine()) != null)
                            {
                                if (!line.StartsWith("data: ")) continue;
                                HandleServerEvent(line.Substring(6));
                            }
                        }
                    }
                    catch { }
                    Thread.Sleep(2000);      // server restarting, or a dropped stream
                }
            });
            thread.IsBackground = true;
            thread.Start();
        }

        private static void HandleServerEvent(string payload)
        {
            try
            {
                var obj = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(payload);
                string type = ServerApi.Str(obj, "type");
                if (type == "toggle-record") ToggleRecording();
                else if (type == "start-record") { if (!recording) StartRecording(); }
                else if (type == "stop-record") { if (recording) StopRecording(false); }
                else if (type == "quit") OnUi(delegate { notify.Visible = false; Application.Exit(); });
            }
            catch { }
        }

        // If server.js goes away, don't leave an orphan icon in the tray.
        private static void StartWatchdog()
        {
            var timer = new System.Windows.Forms.Timer();
            timer.Interval = 5000;
            timer.Tick += delegate
            {
                if (!api.Alive())
                {
                    notify.Visible = false;
                    Application.Exit();
                }
            };
            timer.Start();
        }
    }
}
