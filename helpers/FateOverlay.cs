using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace FateCollector
{
    public sealed class OverlayRow
    {
        public string Label, Detail;
        public bool Recommended;
    }

    public sealed class OverlayAction
    {
        public string Id, Label;
        public int Slot;
    }

    public sealed class OverlayView
    {
        public string ClientId, Revision, CaptureId, Status, Title, Detail, Notice, AcknowledgedCommandId;
        public long WrittenAt;
        public readonly List<OverlayRow> Rows = new List<OverlayRow>();
        public readonly List<OverlayAction> Actions = new List<OverlayAction>();

        public OverlayAction Action(int slot)
        {
            return Actions.Find(action => action.Slot == slot);
        }

        public bool SameContent(OverlayView other)
        {
            if (other == null || ClientId != other.ClientId || Revision != other.Revision || CaptureId != other.CaptureId ||
                Status != other.Status || Title != other.Title || Detail != other.Detail ||
                Rows.Count != other.Rows.Count || Actions.Count != other.Actions.Count) return false;
            for (int i = 0; i < Rows.Count; i++)
            {
                var first = Rows[i];
                var second = other.Rows[i];
                if (first.Label != second.Label || first.Detail != second.Detail || first.Recommended != second.Recommended) return false;
            }
            for (int i = 0; i < Actions.Count; i++)
            {
                var first = Actions[i];
                var second = other.Actions[i];
                if (first.Id != second.Id || first.Label != second.Label || first.Slot != second.Slot) return false;
            }
            return true;
        }
    }

    // The website owns recommendations and game semantics. The native bridge
    // only accepts a bounded, current snapshot and echoes advertised actions.
    public sealed class OverlaySession
    {
        const int MaxBytes = 32768;
        const long Lifetime = 12000;
        const long FutureSkew = 5000;
        static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        static readonly DateTime Epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        readonly string directory;
        readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = MaxBytes, RecursionLimit = 8 };
        string pendingId, pendingClient;
        long pendingAt, noticeUntil;
        string feedback;
        public OverlayView View { get; private set; }
        public string PendingId { get { return pendingId; } }
        public string Feedback { get { return pendingId == null ? feedback : "Waiting for the website to confirm…"; } }

        public OverlaySession(string directory)
        {
            this.directory = Path.GetFullPath(directory);
        }

        public static long Now()
        {
            return (long)(DateTime.UtcNow - Epoch).TotalMilliseconds;
        }

        Dictionary<string, object> Read(string name)
        {
            using (var file = new FileStream(Path.Combine(directory, name), FileMode.Open, FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete))
            {
                int length = checked((int)file.Length);
                if (length == 0 || length > MaxBytes) throw new FormatException();
                var bytes = new byte[length];
                int offset = 0;
                while (offset < length)
                {
                    int size = file.Read(bytes, offset, length - offset);
                    if (size == 0) throw new FormatException();
                    offset += size;
                }
                if (file.ReadByte() != -1) throw new FormatException();
                return json.DeserializeObject(Utf8.GetString(bytes)) as Dictionary<string, object>;
            }
        }

        static Dictionary<string, object> Object(object value, int fields)
        {
            var record = value as Dictionary<string, object>;
            if (record == null || record.Count != fields) throw new FormatException();
            return record;
        }

        static string StringValue(object value, int max, bool nullable = false)
        {
            if (value == null && nullable) return null;
            var result = value as string;
            if (result == null || result.Length > max) throw new FormatException();
            return result;
        }

        static string Id(object value, bool nullable = false)
        {
            string text = StringValue(value, 36, nullable);
            Guid ignored;
            if (text != null && !Guid.TryParseExact(text, "D", out ignored)) throw new FormatException();
            return text;
        }

        static long Integer(object value)
        {
            if (value is int) return (int)value;
            if (value is long) return (long)value;
            throw new FormatException();
        }

        static long Timestamp(object value)
        {
            long result = Integer(value);
            if (result < 0) throw new FormatException();
            return result;
        }

        static object[] ArrayValue(object value, int max)
        {
            var items = value as object[];
            if (items == null || items.Length > max) throw new FormatException();
            return items;
        }

        static string Choice(object value, params string[] allowed)
        {
            string text = StringValue(value, 32);
            if (Array.IndexOf(allowed, text) < 0) throw new FormatException();
            return text;
        }

        static bool Recoverable(Exception error)
        {
            return error is IOException || error is UnauthorizedAccessException || error is FormatException ||
                error is ArgumentException || error is InvalidOperationException || error is OverflowException ||
                error is KeyNotFoundException;
        }

        OverlayView ReadState(long now)
        {
            var data = Object(Read("state.json"), 12);
            if (Integer(data["protocol"]) != 1) throw new FormatException();
            var state = new OverlayView {
                ClientId = Id(data["clientId"]), Revision = Id(data["revision"]),
                WrittenAt = Timestamp(data["writtenAt"]), CaptureId = Id(data["captureId"], true),
                Status = Choice(data["status"], "idle", "busy", "confirm-area", "ready", "provisional", "check", "collected", "error"),
                Title = StringValue(data["title"], 240), Detail = StringValue(data["detail"], 1200),
                AcknowledgedCommandId = Id(data["acknowledgedCommandId"], true), Notice = StringValue(data["notice"], 300, true)
            };
            if (state.WrittenAt > now + FutureSkew || now - state.WrittenAt > Lifetime) return null;
            foreach (var item in ArrayValue(data["rows"], 9))
            {
                var row = Object(item, 3);
                if (!(row["recommended"] is bool)) throw new FormatException();
                state.Rows.Add(new OverlayRow {
                    Label = StringValue(row["label"], 240), Detail = StringValue(row["detail"], 500),
                    Recommended = (bool)row["recommended"]
                });
            }
            var ids = new HashSet<string>(StringComparer.Ordinal);
            var slots = new HashSet<int>();
            foreach (var item in ArrayValue(data["actions"], 12))
            {
                var action = Object(item, 3);
                string id = StringValue(action["id"], 80);
                long slot = Integer(action["slot"]);
                if (id.Length == 0 || slot < 1 || slot > 12 || !ids.Add(id) || !slots.Add((int)slot)) throw new FormatException();
                state.Actions.Add(new OverlayAction { Id = id, Label = StringValue(action["label"], 160), Slot = (int)slot });
            }
            return state;
        }

        static OverlayView Message(string status, string title, string detail)
        {
            return new OverlayView { Status = status, Title = title, Detail = detail };
        }

        public void Poll(long now)
        {
            OverlayView state = null;
            try { state = ReadState(now); }
            catch (Exception error) { if (!Recoverable(error)) throw; }

            if (pendingId != null && state != null && pendingClient == state.ClientId && pendingId == state.AcknowledgedCommandId)
            {
                pendingId = null;
                feedback = null;
            }
            else if (pendingId != null && (now - pendingAt >= Lifetime || now < pendingAt - FutureSkew))
            {
                pendingId = null;
                feedback = "No confirmation yet. Check Fate Collector.";
                noticeUntil = now + 5000;
            }
            if (pendingId == null && now >= noticeUntil) feedback = null;

            string captureId, phase;
            long updated;
            try
            {
                var marker = Object(Read("capture.json"), 4);
                if (Integer(marker["protocol"]) != 1) throw new FormatException();
                updated = Timestamp(marker["updatedAt"]);
                if (updated > now + FutureSkew) throw new FormatException();
                captureId = Id(marker["captureId"], true);
                phase = Choice(marker["phase"], "capturing", "saved", "cancelled", "error", "watching", "paused");
                if (phase == "saved" && captureId == null) throw new FormatException();
            }
            catch (FileNotFoundException)
            {
                View = Message("idle", "Ready for a capture", "Press F9 with a calibrated Fate panel in view.");
                return;
            }
            catch (DirectoryNotFoundException)
            {
                View = Message("idle", "Ready for a capture", "Press F9 with a calibrated Fate panel in view.");
                return;
            }
            catch (Exception error)
            {
                if (!Recoverable(error)) throw;
                View = Message("error", "Capture status unavailable", "Press F9 to try a new capture.");
                return;
            }

            switch (phase)
            {
                case "watching":
                    View = Message("idle", "Watching for Fate cards", "Keep the calibrated Fate panel visible. Stable offers appear automatically. F9 captures manually.");
                    break;
                case "paused":
                    View = Message("idle", "Automatic detection paused", "Check F6/F7 calibration and Auto-detect Fate cards in the helper tray. F9 captures manually.");
                    break;
                case "capturing":
                    View = now - updated > 100000
                        ? Message("error", "Capture interrupted", "Press F9 to try a new capture.")
                        : Message("busy", "Analyzing capture", "Waiting for the Windows helper.");
                    break;
                case "cancelled":
                    View = captureId == null
                        ? Message("idle", "Ready for a capture", "Press F9 with a calibrated Fate panel in view.")
                        : Message("idle", "Capture canceled", "Set the panel with F6 and F7, then press F9.");
                    break;
                case "error":
                    View = Message("error", "Capture failed", "Check the helper message and press F9 to retry.");
                    break;
                default:
                    if (state == null)
                        View = Message("idle", "Waiting for Fate Collector", "Keep the website open with the captures folder connected and overlay enabled.");
                    else if (state.CaptureId != captureId)
                        View = Message("busy", "Waiting for this capture", "The website is still catching up. Keep Fate Collector open.");
                    else
                        View = state;
                    break;
            }
        }

        public bool Send(int slot, OverlayView displayed, long now)
        {
            Poll(now);
            if (pendingId != null || View.ClientId == null || !View.SameContent(displayed))
                return false;
            var action = View.Action(slot);
            if (action == null) return false;

            string id = Guid.NewGuid().ToString("D");
            string temporary = Path.Combine(directory, "command." + id + ".part");
            try
            {
                var record = new { protocol = 1, id, clientId = View.ClientId, revision = View.Revision,
                    captureId = View.CaptureId, action = action.Id, createdAt = now };
                File.WriteAllText(temporary, json.Serialize(record), Utf8);
                if (!MoveFileEx(temporary, Path.Combine(directory, "command.json"), 0x9))
                    throw new IOException();
                pendingId = id;
                pendingClient = View.ClientId;
                pendingAt = now;
                feedback = null;
                return true;
            }
            catch (Exception error)
            {
                if (!Recoverable(error)) throw;
                feedback = "Could not send the shortcut. Check the captures folder.";
                noticeUntil = now + 5000;
                return false;
            }
            finally
            {
                try { File.Delete(temporary); }
                catch (Exception error) { if (!Recoverable(error)) throw; }
            }
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        static extern bool MoveFileEx(string existing, string destination, int flags);
    }

    public sealed class OverlayWindow : Form
    {
        const int CopyData = 0x4a;
        const int MessageTag = 0x46415445;
        const int Layered = 0x80000;
        const int Transparent = 0x20;
        const int ToolWindow = 0x80;
        const int NoActivate = 0x8000000;
        const int ForegroundEvent = 3;
        const int NoActivatePosition = 0x10;
        readonly OverlaySession session;
        readonly Process parent;
        readonly bool preview;
        readonly Timer timer;
        readonly WinEvent foregroundEvent;
        IntPtr hook, game;
        int gamePid;
        Rectangle crop;
        OverlayView displayed;
        OverlayView painted;
        string displayedFeedback;
        bool displayedPending;
        bool actionsFit;
        float scale = 1f;
        Rectangle lastWork;
        Size panelSize;

        static readonly Color Surface = Color.FromArgb(32, 53, 63);
        static readonly Color Quiet = Color.FromArgb(23, 43, 52);
        static readonly Color Raised = Color.FromArgb(42, 70, 81);
        static readonly Color Ink = Color.FromArgb(237, 245, 245);
        static readonly Color Muted = Color.FromArgb(174, 194, 202);
        static readonly Color Border = Color.FromArgb(60, 83, 93);
        static readonly Color Mint = Color.FromArgb(155, 228, 208);
        static readonly Color Amber = Color.FromArgb(242, 204, 145);
        static readonly Color Blue = Color.FromArgb(177, 214, 243);
        static readonly Color Danger = Color.FromArgb(255, 190, 180);

        OverlayWindow(OverlaySession session, Process parent, bool preview)
        {
            this.session = session;
            this.parent = parent;
            this.preview = preview;
            Text = "Fate Collector Overlay";
            AutoScaleMode = AutoScaleMode.None;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            ShowInTaskbar = false;
            BackColor = Surface;
            DoubleBuffered = true;
            timer = new Timer { Interval = 180 };
            timer.Tick += (sender, e) => RefreshOverlay();
            foregroundEvent = ForegroundChanged;
        }

        public static void UsePhysicalCoordinates()
        {
            SetProcessDpiAwarenessContext(new IntPtr(-4));
            SetThreadDpiAwarenessContext(new IntPtr(-4));
        }

        public static void Run(string path, int parentPid, bool preview)
        {
            Process parent = preview ? null : Process.GetProcessById(parentPid);
            try
            {
                // Acquire the actual process handle before accepting any
                // viewport, so PID reuse cannot extend the sidecar lifetime.
                if (parent != null) { var handle = parent.Handle; }
                using (var overlay = new OverlayWindow(new OverlaySession(path), parent, preview))
                {
                    var handle = overlay.Handle;
                    overlay.hook = SetWinEventHook(ForegroundEvent, ForegroundEvent, IntPtr.Zero, overlay.foregroundEvent, 0, 0, 0);
                    overlay.timer.Start();
                    overlay.RefreshOverlay();
                    // Application.Run(Form) makes the form visible even
                    // before the helper has sent a verified viewport.
                    using (var context = new ApplicationContext())
                    {
                        overlay.FormClosed += (sender, e) => context.ExitThread();
                        Application.Run(context);
                    }
                }
            }
            finally { if (parent != null) parent.Dispose(); }
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= Layered | Transparent | ToolWindow | NoActivate;
                return cp;
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            SetLayeredWindowAttributes(Handle, 0, 255, 2);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                timer.Dispose();
                if (hook != IntPtr.Zero) UnhookWinEvent(hook);
                hook = IntPtr.Zero;
            }
            base.Dispose(disposing);
        }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == 0x84) { message.Result = new IntPtr(-1); return; } // HTTRANSPARENT
            if (message.Msg == 0x21) { message.Result = new IntPtr(3); return; } // MA_NOACTIVATE
            if (message.Msg == CopyData && message.LParam != IntPtr.Zero && parent != null && !parent.HasExited)
            {
                int pid;
                GetWindowThreadProcessId(message.WParam, out pid);
                if (pid == parent.Id)
                {
                    var packet = (CopyPacket)Marshal.PtrToStructure(message.LParam, typeof(CopyPacket));
                    if (packet.Tag.ToInt64() == MessageTag && packet.Data != IntPtr.Zero && packet.Size >= 8)
                    {
                        var operation = Marshal.ReadInt64(packet.Data);
                        if (operation == 1 && packet.Size == 56)
                        {
                            game = new IntPtr(Marshal.ReadInt64(packet.Data, 8));
                            gamePid = (int)Marshal.ReadInt64(packet.Data, 16);
                            crop = new Rectangle((int)Marshal.ReadInt64(packet.Data, 24), (int)Marshal.ReadInt64(packet.Data, 32),
                                (int)Marshal.ReadInt64(packet.Data, 40), (int)Marshal.ReadInt64(packet.Data, 48));
                            RefreshOverlay();
                            message.Result = new IntPtr(42);
                            return;
                        }
                        if (operation == 2 && packet.Size == 16 && Visible && actionsFit && GameIsActive())
                        {
                            long slot = Marshal.ReadInt64(packet.Data, 8);
                            if (slot >= 1 && slot <= 12)
                                session.Send((int)slot, painted, OverlaySession.Now());
                            RefreshOverlay();
                            message.Result = new IntPtr(42);
                            return;
                        }
                    }
                }
            }
            base.WndProc(ref message);
        }

        bool GameIsActive()
        {
            if (game == IntPtr.Zero || game != GetForegroundWindow()) return false;
            int pid;
            GetWindowThreadProcessId(game, out pid);
            return pid > 0 && pid == gamePid;
        }

        void ForegroundChanged(IntPtr hook, int kind, IntPtr window, int objectId, int childId, int thread, int time)
        {
            // Hide immediately on focus loss. The timer can show the panel again
            // after the helper has confirmed the game and provided its viewport.
            if (!preview && Visible && !GameIsActive())
            {
                Hide();
                displayed = painted = null;
            }
        }

        void RefreshOverlay()
        {
            if (parent != null && parent.HasExited) { Close(); return; }
            if (!preview && !GameIsActive())
            {
                if (Visible) Hide();
                displayed = painted = null;
                return;
            }

            var monitor = MonitorFromWindow(preview ? GetForegroundWindow() : game, 2);
            if (!preview && !crop.IsEmpty)
            {
                var panel = new Rect { Left = crop.Left, Top = crop.Top, Right = crop.Right, Bottom = crop.Bottom };
                var panelMonitor = MonitorFromRect(ref panel, 0);
                if (panelMonitor != IntPtr.Zero) monitor = panelMonitor;
            }
            var info = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
            if (!GetMonitorInfo(monitor, ref info)) return;
            uint dpi, ignored;
            if (monitor == MonitorFromWindow(Handle, 2)) dpi = GetDpiForWindow(Handle);
            else if (GetDpiForMonitor(monitor, 0, out dpi, out ignored) != 0) dpi = 96;
            float newScale = dpi / 96f;
            if (newScale < 0.75f || newScale > 6f) newScale = 1f;

            session.Poll(OverlaySession.Now());
            var view = session.View;
            var feedback = session.Feedback;
            bool pending = session.PendingId != null;
            bool changed = scale != newScale || !view.SameContent(displayed) || displayed.Notice != view.Notice ||
                displayedFeedback != feedback || displayedPending != pending;
            if (changed) painted = null;
            scale = newScale;
            displayed = view;
            displayedFeedback = feedback;
            displayedPending = pending;
            Rectangle work = info.Work.Rectangle;
            if (changed || lastWork != work || panelSize.IsEmpty)
            {
                int width = Math.Max(1, Math.Min(Pixels(392), work.Width - Pixels(24)));
                using (var graphics = CreateGraphics())
                    panelSize = new Size(width, PaintPanel(graphics, width, work.Height - Pixels(24), false));
                lastWork = work;
            }
            Rectangle location = Place(work, preview ? Rectangle.Empty : crop, panelSize, Pixels(12));
            if (location != Bounds)
            {
                SetWindowPos(Handle, new IntPtr(-1), location.X, location.Y, location.Width, location.Height, NoActivatePosition);
                using (var path = Rounded(new Rectangle(Point.Empty, location.Size), Pixels(14)))
                    Region = new Region(path);
            }
            if (!Visible)
            {
                Show();
                SetWindowPos(Handle, new IntPtr(-1), location.X, location.Y, location.Width, location.Height, NoActivatePosition);
            }
            if (changed) Invalidate();
        }

        public static Rectangle Place(Rectangle work, Rectangle crop, Size size, int gap)
        {
            var available = Rectangle.Inflate(work, -gap, -gap);
            if (available.Width < size.Width || available.Height < size.Height) available = work;
            int x = available.Right - size.Width;
            int y = available.Top;
            if (!crop.IsEmpty && crop.IntersectsWith(work))
            {
                y = crop.Top;
                if (crop.Right + gap + size.Width <= available.Right)
                    x = crop.Right + gap;
                else if (crop.Left - gap - size.Width >= available.Left)
                    x = crop.Left - gap - size.Width;
                else if (crop.Bottom + gap + size.Height <= available.Bottom)
                    y = crop.Bottom + gap;
                else if (crop.Top - gap - size.Height >= available.Top)
                    y = crop.Top - gap - size.Height;
            }
            x = Math.Max(work.Left, Math.Min(x, work.Right - size.Width));
            y = Math.Max(work.Top, Math.Min(y, work.Bottom - size.Height));
            return new Rectangle(x, y, Math.Min(size.Width, work.Width), Math.Min(size.Height, work.Height));
        }

        int Pixels(int logical) { return (int)Math.Round(logical * scale); }

        static GraphicsPath Rounded(Rectangle bounds, int radius)
        {
            var path = new GraphicsPath();
            int diameter = Math.Min(radius * 2, Math.Min(bounds.Width, bounds.Height));
            if (diameter <= 2) { path.AddRectangle(bounds); return path; }
            path.AddArc(bounds.X, bounds.Y, diameter, diameter, 180, 90);
            path.AddArc(bounds.Right - diameter, bounds.Y, diameter, diameter, 270, 90);
            path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(bounds.X, bounds.Bottom - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();
            return path;
        }

        static void Fill(Graphics graphics, Color color, Rectangle bounds, int corner = 0)
        {
            using (var brush = new SolidBrush(color))
            {
                if (corner == 0) graphics.FillRectangle(brush, bounds);
                else using (var path = Rounded(bounds, corner)) graphics.FillPath(brush, path);
            }
        }

        Font Typeface(int logical, bool bold = false)
        {
            return new Font("Segoe UI", Pixels(logical), bold ? FontStyle.Bold : FontStyle.Regular, GraphicsUnit.Pixel);
        }

        const TextFormatFlags CommonText = TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis |
            TextFormatFlags.PreserveGraphicsClipping;
        static void TextLine(Graphics graphics, string value, Font font, Color color, Rectangle bounds, bool right = false)
        {
            TextRenderer.DrawText(graphics, value, font, bounds, color, CommonText | TextFormatFlags.SingleLine |
                TextFormatFlags.VerticalCenter | (right ? TextFormatFlags.Right : TextFormatFlags.Left));
        }

        int TextBlock(Graphics graphics, string value, Font font, Color color, int x, int y, int width, int lines, bool paint)
        {
            if (lines <= 0 || String.IsNullOrWhiteSpace(value)) return 0;
            var flags = CommonText | TextFormatFlags.WordBreak;
            var area = new Size(width, Int32.MaxValue);
            int line = TextRenderer.MeasureText(graphics, "Mg", font, area, CommonText | TextFormatFlags.SingleLine).Height;
            int measured = TextRenderer.MeasureText(graphics, value, font, area, flags).Height;
            int height = Math.Min(line * lines, measured) + Pixels(3);
            if (paint)
            {
                var box = new Rectangle(x, y, width, height);
                if (lines == 1) TextLine(graphics, value, font, color, box);
                else
                {
                    if (measured > line * lines)
                    {
                        int start = 0, end = value.Length;
                        while (start < end)
                        {
                            int index = (start + end + 1) / 2;
                            string candidate = value.Substring(0, index).TrimEnd() + "…";
                            if (TextRenderer.MeasureText(graphics, candidate, font, area, flags).Height <= line * lines) start = index;
                            else end = index - 1;
                        }
                        if (start > 0 && Char.IsHighSurrogate(value[start - 1])) start--;
                        value = value.Substring(0, start).TrimEnd() + "…";
                    }
                    TextRenderer.DrawText(graphics, value, font, box, color, flags);
                }
            }
            return height;
        }

        static string Shortcut(int slot)
        {
            return slot <= 9 ? slot.ToString() : slot == 10 ? "Enter" : slot == 11 ? "N" : "Z";
        }

        static string StateLabel(string state)
        {
            switch (state)
            {
                case "ready": return "Advice ready";
                case "provisional": return "Provisional";
                case "confirm-area": return "Confirm area";
                case "check": return "Needs review";
                case "collected": return "Collected";
                case "error": return "Check capture";
                case "busy": return "Working";
                default: return "Standby";
            }
        }

        static Color StateColor(string state)
        {
            switch (state)
            {
                case "ready": case "collected": return Mint;
                case "provisional": case "confirm-area": return Amber;
                case "check": case "busy": return Blue;
                case "error": return Danger;
                default: return Muted;
            }
        }

        int PaintPanel(Graphics graphics, int width, int maxHeight, bool paint)
        {
            var view = displayed;
            if (view == null) return Pixels(110);
            int height = PanelContent(graphics, view, width, false, false);
            bool fits = height <= maxHeight;
            if (!fits)
            {
                // Retain the reason and confidence even when the complete
                // comparison cannot fit. No action is safe in this view.
                var recommendations = view.Rows.FindAll(row => row.Recommended);
                string reason = recommendations.Count == 1 ? recommendations[0].Detail : "";
                view = new OverlayView {
                    Status = view.Status,
                    Title = view.Title,
                    Detail = String.IsNullOrWhiteSpace(reason) ? view.Detail : reason + "\n" + view.Detail,
                    Notice = "Open the website to compare this offer. Overlay shortcuts are paused."
                };
                height = PanelContent(graphics, view, width, true, false);
            }
            if (!paint) actionsFit = fits;
            if (paint)
            {
                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                graphics.Clear(Surface);
                PanelContent(graphics, view, width, !fits, true);
            }
            return Math.Max(1, Math.Min(height, maxHeight));
        }

        int PanelContent(Graphics graphics, OverlayView view, int width, bool shortcutsPaused, bool paint)
        {
            int pad = Pixels(16), content = Math.Max(1, width - 2 * pad), y = 0;
            int bar = Pixels(41);
            int keyColumn = Pixels(56);
            var stateColor = StateColor(view.Status);
            using (var brand = Typeface(14, true))
            using (var title = Typeface(21, true))
            using (var body = Typeface(14))
            using (var rowTitle = Typeface(14, true))
            using (var small = Typeface(13))
            {
                if (paint)
                {
                    Fill(graphics, Quiet, new Rectangle(0, 0, width, bar));
                    TextLine(graphics, "Fate Collector", brand, Ink, new Rectangle(pad, 0, content / 2, bar));
                    TextLine(graphics, StateLabel(view.Status), small, stateColor,
                        new Rectangle(pad + content / 2, 0, content - content / 2, bar), true);
                    Fill(graphics, Border, new Rectangle(0, bar - 1, width, 1));
                }
                y = bar + Pixels(12);
                y += TextBlock(graphics, view.Title, title, Ink, pad, y, content, 2, paint);
                y += Pixels(3);
                y += TextBlock(graphics, view.Detail, body, Muted, pad, y, content, shortcutsPaused ? 5 : 3, paint);
                y += Pixels(11);

                var shown = new HashSet<int>();
                for (int i = 0; i < view.Rows.Count; i++)
                {
                    var row = view.Rows[i];
                    var action = view.Action(i + 1);
                    int inset = Pixels(8);
                    int typeWidth = Math.Max(1, content - 2 * inset - (action == null ? 0 : keyColumn));
                    string rowDetail = row.Recommended ? "Recommended" + (row.Detail.Length > 0 ? " • " + row.Detail : "") : row.Detail;
                    var wrap = CommonText | TextFormatFlags.WordBreak | TextFormatFlags.TextBoxControl;
                    var measure = new Size(typeWidth, Int32.MaxValue);
                    int nameHeight = Math.Max(Pixels(19), TextRenderer.MeasureText(graphics, row.Label, rowTitle, measure, wrap).Height);
                    int detailHeight = Math.Max(Pixels(17), TextRenderer.MeasureText(graphics, rowDetail, small, measure, wrap).Height);
                    int rowHeight = Pixels(8) + nameHeight + detailHeight;
                    if (action != null) shown.Add(action.Slot);
                    if (paint)
                    {
                        if (row.Recommended) Fill(graphics, Raised, new Rectangle(pad, y, content, rowHeight - 1), Pixels(6));
                        else if (i > 0) Fill(graphics, Border, new Rectangle(pad + inset, y, content - 2 * inset, 1));
                        Color recommendation = view.Status == "provisional" ? Amber : Mint;
                        var nameBounds = new Rectangle(pad + inset, y + Pixels(4), typeWidth, nameHeight);
                        var detailBounds = new Rectangle(pad + inset, nameBounds.Bottom, typeWidth, detailHeight);
                        if (nameHeight <= Pixels(19)) TextLine(graphics, row.Label, rowTitle, Ink, nameBounds);
                        else TextRenderer.DrawText(graphics, row.Label, rowTitle, nameBounds, Ink, wrap);
                        var detailColor = row.Recommended ? recommendation : Muted;
                        if (detailHeight <= Pixels(17)) TextLine(graphics, rowDetail, small, detailColor, detailBounds);
                        else TextRenderer.DrawText(graphics, rowDetail, small, detailBounds, detailColor, wrap);
                        if (action != null)
                            DrawKey(graphics, small, Shortcut(action.Slot), width - pad - inset, y, rowHeight);
                    }
                    y += rowHeight;
                }

                for (int slot = 1; slot <= 12; slot++)
                {
                    var action = view.Action(slot);
                    if (action == null) continue;
                    if (shown.Contains(action.Slot)) continue;
                    int rowHeight = Pixels(30);
                    if (paint)
                    {
                        Fill(graphics, Border, new Rectangle(pad, y, content, 1));
                        TextLine(graphics, action.Label, body, displayedPending ? Muted : Ink,
                            new Rectangle(pad, y, Math.Max(1, content - keyColumn), rowHeight));
                        DrawKey(graphics, small, Shortcut(action.Slot), width - pad, y, rowHeight);
                    }
                    y += rowHeight;
                }

                string notice = shortcutsPaused ? view.Notice : displayedFeedback ?? view.Notice;
                if (!String.IsNullOrEmpty(notice))
                {
                    y += Pixels(5);
                    y += TextBlock(graphics, notice, small, shortcutsPaused || displayedFeedback != null ? Amber : Blue,
                        pad, y, content, 2, paint);
                }

                y += Pixels(8);
                int footer = Pixels(31);
                if (paint)
                {
                    Fill(graphics, Quiet, new Rectangle(0, y, width, footer));
                    Fill(graphics, Border, new Rectangle(0, y, width, 1));
                    TextLine(graphics, view.Actions.Count == 0 ? "F9  Capture   ·   Ctrl+Alt+O  Hide" : "Hold Ctrl+Alt for shortcuts   ·   O  Hide",
                        small, Muted, new Rectangle(pad, y, content, footer));
                }
                return y + footer;
            }
        }

        void DrawKey(Graphics graphics, Font font, string key, int right, int y, int rowHeight)
        {
            int width = Pixels(key.Length > 1 ? 49 : 25);
            int height = Math.Min(rowHeight - Pixels(2), Pixels(22));
            Rectangle box = new Rectangle(right - width, y + (rowHeight - height) / 2, width, height);
            Fill(graphics, Quiet, box, Pixels(5));
            TextRenderer.DrawText(graphics, key, font, box, displayedPending ? Muted : Mint,
                CommonText | TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            PaintPanel(e.Graphics, ClientSize.Width, ClientSize.Height, true);
            painted = Visible && actionsFit ? displayed : null;
        }

        // An offline preview uses the exact same window, controls and painter
        // without entering the Windows foreground or writing commands.
        public static Bitmap Snapshot(OverlaySession session, int dpi, int workWidth, int workHeight, out bool shortcutsFit)
        {
            using (var overlay = new OverlayWindow(session, null, true))
            {
                overlay.scale = dpi / 96f;
                overlay.displayed = session.View;
                overlay.displayedFeedback = session.Feedback;
                overlay.displayedPending = session.PendingId != null;
                int width = Math.Min(overlay.Pixels(392), workWidth - overlay.Pixels(24));
                int height;
                using (var graphics = overlay.CreateGraphics())
                    height = overlay.PaintPanel(graphics, width, workHeight - overlay.Pixels(24), false);
                shortcutsFit = overlay.actionsFit;
                overlay.ClientSize = new Size(width, height);
                var bitmap = new Bitmap(width, height);
                overlay.DrawToBitmap(bitmap, new Rectangle(0, 0, width, height));
                return bitmap;
            }
        }

        [StructLayout(LayoutKind.Sequential)]
        struct CopyPacket { public IntPtr Tag; public int Size; public IntPtr Data; }
        [StructLayout(LayoutKind.Sequential)]
        struct Rect
        {
            public int Left, Top, Right, Bottom;
            public Rectangle Rectangle { get { return Rectangle.FromLTRB(Left, Top, Right, Bottom); } }
        }
        [StructLayout(LayoutKind.Sequential)]
        struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }
        delegate void WinEvent(IntPtr hook, int kind, IntPtr window, int objectId, int childId, int thread, int time);
        [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
        [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern int GetWindowThreadProcessId(IntPtr hwnd, out int pid);
        [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
        [DllImport("user32.dll")] static extern IntPtr MonitorFromRect(ref Rect rect, uint flags);
        [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
        [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint dpiX, out uint dpiY);
        [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint key, byte alpha, int flags);
        [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, int flags);
        [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(int min, int max, IntPtr module, WinEvent callback, int pid, int thread, int flags);
        [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
    }
}
