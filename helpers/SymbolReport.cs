using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Text;
using System.Windows.Forms;

public sealed class FateSymbolCrop
{
    public readonly Rectangle Bounds;
    public readonly byte[] Png;

    private FateSymbolCrop(Rectangle bounds, byte[] png)
    {
        Bounds = bounds;
        Png = png;
    }

    public static FateSymbolCrop Create(Bitmap frame, Rectangle bounds, bool isIcon)
    {
        int maxSide = isIcon ? 256 : 1600;
        int maxBytes = (isIcon ? 64 : 384) * 1024;
        if (bounds.Width < 8 || bounds.Height < 8 || bounds.Width > maxSide || bounds.Height > maxSide)
            throw new ArgumentException("Select an area between 8 and " + maxSide + " pixels on each side.");
        if (bounds.X < 0 || bounds.Y < 0 || bounds.X > frame.Width - bounds.Width || bounds.Y > frame.Height - bounds.Height)
            throw new ArgumentException("Keep the selection inside the screenshot.");

        using (var crop = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb))
        using (var stream = new MemoryStream())
        {
            using (var graphics = Graphics.FromImage(crop))
                graphics.DrawImageUnscaled(frame, -bounds.X, -bounds.Y);
            crop.Save(stream, ImageFormat.Png);
            byte[] png = StripPngMetadata(stream.ToArray());
            if (png.Length > maxBytes)
                throw new ArgumentException("The image exceeds " + maxBytes / 1024 + " KiB. Select a tighter crop.");
            return new FateSymbolCrop(bounds, png);
        }
    }

    // The input comes from GDI+'s encoder above. Preserve the original chunk CRCs.
    private static byte[] StripPngMetadata(byte[] png)
    {
        using (var clean = new MemoryStream())
        {
            clean.Write(png, 0, 8);
            for (int offset = 8; offset <= png.Length - 12;)
            {
                uint length = ((uint)png[offset] << 24) | ((uint)png[offset + 1] << 16)
                    | ((uint)png[offset + 2] << 8) | png[offset + 3];
                if (length > png.Length - offset - 12)
                    throw new InvalidDataException("The PNG encoder returned an invalid chunk.");
                int size = (int)length + 12;
                string name = Encoding.ASCII.GetString(png, offset + 4, 4);
                switch (name)
                {
                    case "IHDR":
                        if (length != 13 || png[offset + 16] != 8 || png[offset + 20] != 0)
                            throw new InvalidDataException("The PNG encoder returned an unsupported format.");
                        goto case "IDAT";
                    case "IDAT":
                    case "sRGB":
                    case "pHYs":
                        clean.Write(png, offset, size);
                        break;
                    case "IEND":
                        clean.Write(png, offset, size);
                        return clean.ToArray();
                }
                offset += size;
            }
            throw new InvalidDataException("The PNG encoder returned an incomplete image.");
        }
    }
}

internal sealed class FateCropCanvas : Control
{
    private readonly Bitmap frame;
    private Point anchor;
    private Point cursor;
    private bool dragging;

    public FateCropCanvas(Bitmap frame)
    {
        this.frame = frame;
        SetStyle(ControlStyles.Selectable | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
        AccessibleName = "Frozen game screenshot";
        AccessibleDescription = "Drag a rectangle. Use arrow keys to move the crosshair and Shift plus arrows to extend the selection.";
        TabStop = true;
        Dock = DockStyle.Fill;
        BackColor = Color.FromArgb(16, 25, 30);
        Cursor = Cursors.Cross;
        Reset(Rectangle.Empty);
    }

    public Rectangle Selection
    {
        get
        {
            return Rectangle.FromLTRB(Math.Min(anchor.X, cursor.X), Math.Min(anchor.Y, cursor.Y),
                Math.Max(anchor.X, cursor.X) + 1, Math.Max(anchor.Y, cursor.Y) + 1);
        }
    }

    public void Reset(Rectangle selection)
    {
        anchor = selection.IsEmpty ? new Point(frame.Width / 2, frame.Height / 2) : selection.Location;
        cursor = selection.IsEmpty ? anchor : new Point(selection.Right - 1, selection.Bottom - 1);
        Invalidate();
    }

    private RectangleF ImageArea()
    {
        float scale = Math.Min((float)ClientSize.Width / frame.Width, (float)ClientSize.Height / frame.Height);
        float width = frame.Width * scale;
        float height = frame.Height * scale;
        return new RectangleF((ClientSize.Width - width) / 2, (ClientSize.Height - height) / 2, width, height);
    }

    private Point Clamp(int x, int y)
    {
        return new Point(Math.Min(Math.Max(0, x), frame.Width - 1), Math.Min(Math.Max(0, y), frame.Height - 1));
    }

    private Point FramePoint(Point point, RectangleF area)
    {
        return Clamp((int)Math.Floor((point.X - area.X) * frame.Width / area.Width),
            (int)Math.Floor((point.Y - area.Y) * frame.Height / area.Height));
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        RectangleF area = ImageArea();
        if (e.Button != MouseButtons.Left || !area.Contains(e.Location)) return;
        Focus();
        dragging = true;
        Capture = true;
        anchor = cursor = FramePoint(e.Location, area);
        Invalidate();
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        if (!dragging) return;
        cursor = FramePoint(e.Location, ImageArea());
        Invalidate();
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        if (!dragging || e.Button != MouseButtons.Left) return;
        OnMouseMove(e);
        Capture = false;
    }

    protected override void OnMouseCaptureChanged(EventArgs e)
    {
        dragging = false;
        base.OnMouseCaptureChanged(e);
    }

    protected override bool IsInputKey(Keys keyData)
    {
        switch (keyData & Keys.KeyCode)
        {
            case Keys.Left: case Keys.Right: case Keys.Up: case Keys.Down: return true;
            default: return base.IsInputKey(keyData);
        }
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        int dx = 0, dy = 0;
        switch (e.KeyCode)
        {
            case Keys.Left: dx = -1; break;
            case Keys.Right: dx = 1; break;
            case Keys.Up: dy = -1; break;
            case Keys.Down: dy = 1; break;
            default: base.OnKeyDown(e); return;
        }
        int step = e.Control ? 16 : 1;
        cursor = Clamp(cursor.X + dx * step, cursor.Y + dy * step);
        if (!e.Shift) anchor = cursor;
        e.Handled = true;
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        RectangleF area = ImageArea();
        if (area.Width < 1 || area.Height < 1) return;
        e.Graphics.DrawImage(frame, area);
        float scale = area.Width / frame.Width;
        Rectangle selected = Selection;
        var outline = new RectangleF(area.X + selected.X * scale, area.Y + selected.Y * scale,
            selected.Width * scale, selected.Height * scale);
        using (var border = new Pen(Color.Black, 4))
        using (var highlight = new Pen(Color.FromArgb(155, 228, 208), 2))
        {
            if (selected.Width == 1 && selected.Height == 1) outline.Inflate(4, 4);
            foreach (Pen pen in new[] { border, highlight })
                e.Graphics.DrawRectangle(pen, outline.X, outline.Y, outline.Width, outline.Height);
        }
        if (Focused)
            ControlPaint.DrawFocusRectangle(e.Graphics, Rectangle.Inflate(ClientRectangle, -3, -3));
    }

    protected override void OnResize(EventArgs e) { base.OnResize(e); Invalidate(); }
    protected override void OnGotFocus(EventArgs e) { base.OnGotFocus(e); Invalidate(); }
    protected override void OnLostFocus(EventArgs e) { base.OnLostFocus(e); Invalidate(); }
}

public sealed class FateSymbolReportForm : Form
{
    private readonly Bitmap frame;
    private readonly FateCropCanvas canvas;
    private readonly TableLayoutPanel review;
    private readonly PictureBox iconPreview;
    private readonly PictureBox tooltipPreview;
    private readonly Label title;
    private readonly Label instructions;
    private readonly Label error;
    private readonly Button next;
    private enum Step { Icon, Tooltip, Review }
    private Step step;

    public FateSymbolCrop IconCrop { get; private set; }
    public FateSymbolCrop TooltipCrop { get; private set; }

    public FateSymbolReportForm(Bitmap frame, bool fixture)
    {
        this.frame = frame;
        Text = fixture ? "Report symbol fixture - Fate Collector" : "Report symbol - Fate Collector";
        Font = SystemFonts.MessageBoxFont;
        AutoScaleMode = AutoScaleMode.Font;
        StartPosition = FormStartPosition.CenterScreen;
        Rectangle desktop = Screen.FromPoint(Cursor.Position).WorkingArea;
        Size = new Size(Math.Min(1240, desktop.Width), Math.Min(850, desktop.Height));
        MinimumSize = new Size(Math.Min(640, desktop.Width), Math.Min(420, desktop.Height));

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 5, Padding = new Padding(16) };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        Controls.Add(layout);

        title = new Label { AutoSize = true, Font = new Font(Font.FontFamily, 16, FontStyle.Bold) };
        instructions = new Label { AutoSize = true, Margin = new Padding(3, 4, 3, 12) };
        error = new Label { AutoSize = true, ForeColor = SystemColors.WindowText, Margin = new Padding(3, 8, 3, 3) };
        canvas = new FateCropCanvas(frame);
        var content = new Panel { Dock = DockStyle.Fill };
        review = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 3 };
        review.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 35));
        review.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 65));
        review.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        review.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        review.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        iconPreview = AddPreview(0, "Icon", "Reselect icon", true);
        tooltipPreview = AddPreview(1, "Tooltip", "Reselect tooltip", false);
        content.Controls.Add(canvas);
        content.Controls.Add(review);
        layout.Controls.Add(title, 0, 0);
        layout.Controls.Add(instructions, 0, 1);
        layout.Controls.Add(content, 0, 2);
        layout.Controls.Add(error, 0, 3);

        var actions = new FlowLayoutPanel {
            Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, AutoSize = true, WrapContents = false
        };
        next = ActionButton("");
        var cancel = ActionButton("Cancel");
        cancel.DialogResult = DialogResult.Cancel;
        next.Click += Advance;
        actions.Controls.Add(next);
        actions.Controls.Add(cancel);
        layout.Controls.Add(actions, 0, 4);
        AcceptButton = next;
        CancelButton = cancel;
        SelectCrop(true);
        Shown += delegate { canvas.Focus(); };
    }

    private static Button ActionButton(string text)
    {
        return new Button { Text = text, AutoSize = true, MinimumSize = new Size(88, 32) };
    }

    private PictureBox AddPreview(int column, string label, string action, bool isIcon)
    {
        var preview = new PictureBox {
            Dock = DockStyle.Fill, SizeMode = PictureBoxSizeMode.Zoom,
            BackColor = Color.FromArgb(16, 25, 30), AccessibleName = label + " preview"
        };
        var button = ActionButton(action);
        button.Click += delegate { SelectCrop(isIcon); };
        review.Controls.Add(new Label { Text = label, AutoSize = true }, column, 0);
        review.Controls.Add(preview, column, 1);
        review.Controls.Add(button, column, 2);
        return preview;
    }

    private void SelectCrop(bool isIcon)
    {
        step = isIcon ? Step.Icon : Step.Tooltip;
        var prior = isIcon ? IconCrop : TooltipCrop;
        title.Text = isIcon ? "Select the symbol icon" : "Select the tooltip";
        instructions.Text = "Drag a tight rectangle. Arrow keys move the crosshair. Hold Shift to extend the selection.";
        error.Text = "";
        next.Text = isIcon ? "Use icon" : "Use tooltip";
        canvas.Reset(prior == null ? Rectangle.Empty : prior.Bounds);
        canvas.Show();
        review.Hide();
        canvas.Focus();
    }

    private void Advance(object sender, EventArgs e)
    {
        if (step == Step.Review)
        {
            DialogResult = DialogResult.OK;
            return;
        }
        try
        {
            var crop = FateSymbolCrop.Create(frame, canvas.Selection, step == Step.Icon);
            if (step == Step.Icon) IconCrop = crop;
            else TooltipCrop = crop;
        }
        catch (ArgumentException failure)
        {
            error.Text = failure.Message;
            canvas.Focus();
            return;
        }
        if (TooltipCrop == null)
        {
            SelectCrop(false);
            return;
        }
        title.Text = "Review the two crops";
        instructions.Text = "Continue to save the draft. Paste it on the website to review, consent and send.";
        error.Text = "";
        next.Text = "Continue to website";
        step = Step.Review;
        ReplacePreview(iconPreview, IconCrop);
        ReplacePreview(tooltipPreview, TooltipCrop);
        canvas.Hide();
        review.Show();
        next.Focus();
    }

    private void ReplacePreview(PictureBox preview, FateSymbolCrop crop)
    {
        if (preview.Image != null) preview.Image.Dispose();
        using (var stream = new MemoryStream(crop.Png, false))
        using (var image = new Bitmap(stream))
            preview.Image = new Bitmap(image);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            if (iconPreview.Image != null) iconPreview.Image.Dispose();
            if (tooltipPreview.Image != null) tooltipPreview.Image.Dispose();
            title.Font.Dispose();
        }
        base.Dispose(disposing);
    }
}
