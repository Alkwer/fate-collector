// Contrast stretching and scaled OCR. Component attribution: THIRD_PARTY_NOTICES.md.
// Fate retains the original PNG and maps every OCR rectangle back to its pixels.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public sealed class FateOcrImage
{
    public byte[] Png;
    public double ScaleX, ScaleY;
    public int Padding;

    public sealed class Counter
    {
        public readonly string Text;
        public readonly Rectangle Bounds;
        public readonly int SlashHeight;
        public readonly bool HasHudCards;
        public readonly bool IsIsolatedPlaque;

        internal Counter(int current, int capacity, Rectangle bounds, int slashHeight, bool hasHudCards, bool isIsolatedPlaque)
        {
            Text = current.ToString() + "/" + capacity.ToString();
            Bounds = bounds;
            SlashHeight = slashHeight;
            HasHudCards = hasHudCards;
            IsIsolatedPlaque = isIsolatedPlaque;
        }
    }

    public static Counter[] ReadCounters(byte[] png)
    {
        using (var input = new MemoryStream(png, false))
        using (var original = new Bitmap(input))
        using (var source = new Bitmap(original.Width, original.Height, PixelFormat.Format24bppRgb))
        {
            using (var graphics = Graphics.FromImage(source)) graphics.DrawImageUnscaled(original, 0, 0);
            var region = new Rectangle(0, 0, source.Width, source.Height);
            var data = source.LockBits(region, ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
            try
            {
                return new CounterImage(source.Width, source.Height, data).Read();
            }
            finally { source.UnlockBits(data); }
        }
    }

    private sealed class CounterImage
    {
        private const int MinSlashHeight = 11;
        private const int MaxSlashHeight = 64;
        // Normalized ink coverage for the supported UI digits. The slash is checked separately.
        private static readonly string[] Digits =
        {
            "07970" + "76067" + "85048" + "85048" + "85048" + "67067" + "07970",
            "58999" + "34999" + "00990" + "00990" + "00990" + "00990" + "00990",
            "67983" + "61094" + "00094" + "00990" + "03860" + "38500" + "99888",
            "67970" + "61094" + "03790" + "00990" + "00099" + "30094" + "67970",
            "00590" + "03990" + "27590" + "62590" + "89799" + "22591" + "00390"
        };
        private const string OneRightStem = "44999" + "44499" + "00099" + "00099" + "00099" + "00099" + "00099";

        private readonly int width, height, stride;
        private readonly IntPtr scan;
        private readonly byte[] rowPixels;

        private sealed class Glyph
        {
            public readonly Rectangle Bounds;
            public readonly bool[] Ink;

            public Glyph(Rectangle bounds, List<int> points, int imageWidth)
            {
                Bounds = bounds;
                Ink = new bool[bounds.Width * bounds.Height];
                foreach (int point in points)
                    Ink[(point / imageWidth - bounds.Top) * bounds.Width + point % imageWidth - bounds.Left] = true;
            }
        }

        public CounterImage(int width, int height, BitmapData data)
        {
            this.width = width;
            this.height = height;
            stride = data.Stride;
            scan = data.Scan0;
            rowPixels = new byte[width * 3];
        }

        public Counter[] Read()
        {
            List<Glyph> glyphs = FindGlyphs();
            glyphs.Sort((a, b) => a.Bounds.Left.CompareTo(b.Bounds.Left));
            var counters = new List<Counter>();
            for (int i = 0; i < glyphs.Count; i++)
            {
                Glyph slash = glyphs[i];
                Rectangle box = slash.Bounds;
                if (!IsSlash(slash) || !OnDarkPlaque(box)) continue;
                Glyph left = FindAdjacentDigit(glyphs, i, -1);
                Glyph right = FindAdjacentDigit(glyphs, i, 1);
                if (left == null || right == null) continue;
                int capacity = ReadDigit(right);
                int current = ReadDigit(left);
                if (capacity <= 0 || current < 0 || current > capacity) continue;
                Rectangle bounds = Rectangle.Union(left.Bounds, Rectangle.Union(box, right.Bounds));
                counters.Add(new Counter(current, capacity, bounds, box.Height, HasHudCards(box), IsIsolatedPlaque(box)));
            }
            return counters.ToArray();
        }

        private List<Glyph> FindGlyphs()
        {
            var unvisited = new byte[width * height];
            bool sawInk = false, sawDark = false;
            for (int y = 0; y < height; y++)
            {
                Marshal.Copy(IntPtr.Add(scan, y * stride), rowPixels, 0, rowPixels.Length);
                for (int x = 0; x < width; x++)
                {
                    int offset = x * 3;
                    int b = rowPixels[offset], g = rowPixels[offset + 1], r = rowPixels[offset + 2];
                    int low = Math.Min(r, Math.Min(g, b));
                    int high = Math.Max(r, Math.Max(g, b));
                    if (high < 34) sawDark = true;
                    if (low >= 130 && high - low < 44)
                    {
                        unvisited[y * width + x] = 1;
                        sawInk = true;
                    }
                }
            }

            var glyphs = new List<Glyph>();
            if (!sawDark || !sawInk) return glyphs;
            var points = new List<int>();
            var pending = new Queue<int>();
            for (int index = 0; index < unvisited.Length; index++)
            {
                if (unvisited[index] == 0) continue;
                points.Clear();
                Visit(index, unvisited, pending);
                int left = width, right = 0, top = height, bottom = 0;
                while (pending.Count > 0)
                {
                    int point = pending.Dequeue(), x = point % width, y = point / width;
                    left = Math.Min(left, x); right = Math.Max(right, x);
                    top = Math.Min(top, y); bottom = Math.Max(bottom, y);
                    if (right - left < MaxSlashHeight && bottom - top < MaxSlashHeight) points.Add(point);
                    // Four-connected strokes keep adjacent slash and digit corners separate.
                    if (x > 0) Visit(point - 1, unvisited, pending);
                    if (x + 1 < width) Visit(point + 1, unvisited, pending);
                    if (y > 0) Visit(point - width, unvisited, pending);
                    if (y + 1 < height) Visit(point + width, unvisited, pending);
                }
                int glyphWidth = right - left + 1, glyphHeight = bottom - top + 1;
                if (glyphHeight >= 6 && glyphHeight <= MaxSlashHeight &&
                    glyphWidth >= 2 && glyphWidth < glyphHeight && points.Count >= glyphHeight)
                    glyphs.Add(new Glyph(Rectangle.FromLTRB(left, top, right + 1, bottom + 1), points, width));
            }
            return glyphs;
        }

        private static void Visit(int point, byte[] unvisited, Queue<int> pending)
        {
            if (unvisited[point] == 0) return;
            unvisited[point] = 0;
            pending.Enqueue(point);
        }

        private static bool IsSlash(Glyph glyph)
        {
            int w = glyph.Bounds.Width, h = glyph.Bounds.Height;
            if (h < MinSlashHeight || w < h * .15 || w > h * .43) return false;
            var centers = new double[h];
            for (int y = 0; y < h; y++)
            {
                int start = w, end = -1, ink = 0;
                for (int x = 0; x < w; x++)
                    if (glyph.Ink[y * w + x])
                    {
                        start = Math.Min(start, x);
                        end = x;
                        ink++;
                    }
                if (ink == 0 || ink != end - start + 1 || ink > Math.Max(2.0, h * .19)) return false;
                centers[y] = (start + end) / 2.0;
            }
            double shift = centers[0] - centers[h - 1];
            if (shift < h * .12 || shift > h * .35) return false;
            for (int y = 1; y < h - 1; y++)
                if (Math.Abs(centers[y] - (centers[0] - shift * y / (h - 1))) > Math.Max(1.4, h * .07))
                    return false;
            return true;
        }

        private static Glyph FindAdjacentDigit(List<Glyph> glyphs, int slashIndex, int direction)
        {
            Rectangle slash = glyphs[slashIndex].Bounds;
            double h = slash.Height;
            Glyph match = null;
            for (int i = slashIndex + direction; i >= 0 && i < glyphs.Count; i += direction)
            {
                Rectangle box = glyphs[i].Bounds;
                int gap = direction < 0 ? slash.Left - box.Right : box.Left - slash.Right;
                if (Math.Abs(box.Left - slash.Left) > h * .95) break;
                if (gap < -h * .12 || gap > h * .23 ||
                    box.Height < h * .50 || box.Height > h * .87 ||
                    box.Top < slash.Top || box.Top - slash.Top > h * .22 ||
                    slash.Bottom - box.Bottom < h * .06 || slash.Bottom - box.Bottom > h * .39)
                    continue;
                if (match != null) return null;
                match = glyphs[i];
            }
            return match;
        }

        private static int ReadDigit(Glyph glyph)
        {
            int w = glyph.Bounds.Width, h = glyph.Bounds.Height;
            var coverage = new double[35];
            // Supersample the tight mask, discarding the source image location and resolution.
            for (int y = 0; y < 28; y++)
                for (int x = 0; x < 20; x++)
                    if (glyph.Ink[((2 * y + 1) * h / 56) * w + (2 * x + 1) * w / 40])
                        coverage[y / 4 * 5 + x / 4] += 1.0 / 16;

            int best = -1;
            double bestError = 1, secondError = 1;
            for (int digit = 0; digit < Digits.Length; digit++)
            {
                double aspect = (double)w / h;
                if (digit == 1 ? aspect > .52 : aspect < .49 || aspect > .94) continue;
                double error = DigitError(coverage, Digits[digit]);
                if (digit == 1) error = Math.Min(error, DigitError(coverage, OneRightStem));
                if (error < bestError)
                {
                    secondError = bestError;
                    bestError = error;
                    best = digit;
                }
                else secondError = Math.Min(secondError, error);
            }
            return bestError <= .26 && secondError - bestError >= .035 ? best : -1;
        }

        private static double DigitError(double[] coverage, string digit)
        {
            double error = 0;
            for (int i = 0; i < coverage.Length; i++)
                error += Math.Abs(coverage[i] - (digit[i] - '0') / 9.0);
            return error / coverage.Length;
        }

        private bool OnDarkPlaque(Rectangle slash)
        {
            return Sample(slash, -1.8, -.37, -.8, .35, (r, g, b) => Math.Max(r, Math.Max(g, b)) < 34) >= .85 &&
                Sample(slash, .8, -.37, 1.8, .35, (r, g, b) => Math.Max(r, Math.Max(g, b)) < 34) >= .85;
        }

        private bool HasHudCards(Rectangle slash)
        {
            // The HUD plaque sits directly above the light-edged, blue stack of cards.
            Func<int, int, int, bool> blue = (r, g, b) => b >= 65 && b - r >= 23 && b - g >= 10;
            return Sample(slash, -.7, 2.2, .7, 3.3, blue) >= .74 &&
                Sample(slash, -1.55, 2.2, -1.15, 3.3, blue) <= .30 &&
                Sample(slash, -1, 1.45, .7, 2.15, (r, g, b) => b > 120 && r > 90 && g > 90) >= .35;
        }

        private bool IsIsolatedPlaque(Rectangle slash)
        {
            double h = slash.Height, x = slash.Left + slash.Width / 2.0, y = slash.Top + h / 2;
            // A counter-only diagnostic crop must tightly frame one centered plaque with visible trim.
            return width >= 4.5 * h && width <= 7 * h && height >= 1.75 * h && height <= 2.6 * h &&
                Math.Abs(x - width / 2.0) <= width * .12 && Math.Abs(y - height / 2.0) <= height * .12 &&
                HasPlaqueRail(slash, -.89, -.58) && HasPlaqueRail(slash, .34, .72);
        }

        private bool HasPlaqueRail(Rectangle slash, double top, double bottom)
        {
            double h = slash.Height, y = slash.Top + h / 2;
            Func<int, int, int, bool> trim = (r, g, b) => Math.Max(r, Math.Max(g, b)) >= 19;
            for (int row = (int)Math.Round(y + top * h); row < Math.Round(y + bottom * h); row++)
            {
                double relative = (row - y) / h;
                if (Sample(slash, -1.45, relative, -.85, relative + 1 / h, trim) >= .55 &&
                    Sample(slash, .85, relative, 1.45, relative + 1 / h, trim) >= .55)
                    return true;
            }
            return false;
        }

        private double Sample(Rectangle slash, double left, double top, double right, double bottom, Func<int, int, int, bool> test)
        {
            double x = slash.Left + slash.Width / 2.0, y = slash.Top + slash.Height / 2.0, h = slash.Height;
            int x0 = (int)Math.Round(x + left * h), x1 = (int)Math.Round(x + right * h);
            int y0 = (int)Math.Round(y + top * h), y1 = (int)Math.Round(y + bottom * h);
            if (x0 < 0 || y0 < 0 || x1 > width || y1 > height) return double.NaN;
            int hits = 0;
            for (int row = y0; row < y1; row++)
            {
                int length = (x1 - x0) * 3;
                Marshal.Copy(IntPtr.Add(scan, row * stride + x0 * 3), rowPixels, 0, length);
                for (int offset = 0; offset < length; offset += 3)
                    if (test(rowPixels[offset + 2], rowPixels[offset + 1], rowPixels[offset])) hits++;
            }
            return (double)hits / ((x1 - x0) * (y1 - y0));
        }
    }

    public static FateOcrImage Prepare(byte[] png, int maxDimension)
    {
        return Prepare(png, maxDimension, Rectangle.Empty);
    }

    public static FateOcrImage Prepare(byte[] png, int maxDimension, Rectangle region)
    {
        const int padding = 16;
        int limit = Math.Min(maxDimension, 4096) - padding * 2;
        if (limit < 16) throw new ArgumentOutOfRangeException("maxDimension");
        using (var input = new MemoryStream(png, false))
        using (var original = new Bitmap(input))
        using (var source = new Bitmap(region.IsEmpty ? original.Width : region.Width,
            region.IsEmpty ? original.Height : region.Height, PixelFormat.Format24bppRgb))
        {
            using (var graphics = Graphics.FromImage(source)) graphics.DrawImageUnscaled(original, -region.X, -region.Y);
            var rect = new Rectangle(0, 0, source.Width, source.Height);
            var data = source.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format24bppRgb);
            try
            {
                int stride = Math.Abs(data.Stride);
                var pixels = new byte[stride * source.Height];
                Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);
                var histogram = new int[256];
                for (int y = 0; y < source.Height; y++)
                    for (int x = 0; x < source.Width; x++)
                    {
                        int offset = y * stride + x * 3;
                        byte value = (byte)((pixels[offset] * 114 + pixels[offset + 1] * 587 + pixels[offset + 2] * 299) / 1000);
                        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = value;
                        histogram[value]++;
                    }
                int count = source.Width * source.Height, low = 0, high = 255, seen = 0;
                while (low < 255 && seen + histogram[low] <= count * 0.02) seen += histogram[low++];
                seen = 0;
                while (high > 0 && seen + histogram[high] <= count * 0.02) seen += histogram[high--];
                // Uniform images stay uniform: do not manufacture contrast or text.
                if (high > low)
                    for (int y = 0; y < source.Height; y++)
                        for (int x = 0; x < source.Width; x++)
                        {
                            int offset = y * stride + x * 3;
                            byte value = (byte)Math.Max(0, Math.Min(255, (pixels[offset] - low) * 255 / (high - low)));
                            pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = value;
                        }
                Marshal.Copy(pixels, 0, data.Scan0, pixels.Length);
            }
            finally { source.UnlockBits(data); }
            double scale = Math.Min(2.0, (double)limit / Math.Max(source.Width, source.Height));
            int width = Math.Max(1, (int)Math.Round(source.Width * scale));
            int height = Math.Max(1, (int)Math.Round(source.Height * scale));
            using (var prepared = new Bitmap(width + padding * 2, height + padding * 2, PixelFormat.Format24bppRgb))
            using (var output = new MemoryStream())
            {
                using (var graphics = Graphics.FromImage(prepared))
                {
                    graphics.Clear(source.GetPixel(0, 0));
                    graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    using (var attributes = new ImageAttributes())
                    {
                        attributes.SetWrapMode(WrapMode.TileFlipXY);
                        graphics.DrawImage(source, new Rectangle(padding, padding, width, height),
                            0, 0, source.Width, source.Height, GraphicsUnit.Pixel, attributes);
                    }
                }
                prepared.Save(output, ImageFormat.Png);
                return new FateOcrImage { Png = output.ToArray(), Padding = padding,
                    ScaleX = (double)width / source.Width, ScaleY = (double)height / source.Height };
            }
        }
    }
}
