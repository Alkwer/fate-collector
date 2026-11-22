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
        public readonly bool HasPlaqueTrim;

        internal Counter(int current, int capacity, Rectangle bounds, int slashHeight, bool hasHudCards,
            bool isIsolatedPlaque, bool hasPlaqueTrim = false)
        {
            Text = current.ToString() + "/" + capacity.ToString();
            Bounds = bounds;
            SlashHeight = slashHeight;
            HasHudCards = hasHudCards;
            IsIsolatedPlaque = isIsolatedPlaque;
            HasPlaqueTrim = hasPlaqueTrim;
        }
    }

    public static Counter[] ReadCounters(byte[] png)
    {
        return ReadCounters(png, Rectangle.Empty);
    }

    public static Counter[] ReadCounters(byte[] png, Rectangle panelRegion)
    {
        return ReadCounters(png, panelRegion, false);
    }

    public static Counter ReadCoveredCounter(byte[] png, Rectangle panelRegion)
    {
        var counters = ReadCounters(png, panelRegion, true);
        return counters.Length == 1 ? counters[0] : null;
    }

    private static Counter[] ReadCounters(byte[] png, Rectangle panelRegion, bool panelOnly)
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
                var image = new CounterImage(source.Width, source.Height, data);
                if (!panelOnly) return image.Read(panelRegion);
                Counter covered = image.ReadCoveredCounter(panelRegion);
                return covered == null ? new Counter[0] : new[] { covered };
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
        // Alternate coverage for the thin, antialiased plaque lettering.
        private static readonly string[] PlaqueDigits =
        {
            "04861" + "36176" + "62028" + "91019" + "73017" + "56245" + "16760",
            "35898" + "44698" + "00498" + "00498" + "00498" + "00498" + "00498",
            "68782" + "51196" + "00195" + "00381" + "02810" + "17200" + "88776",
            "57662" + "41085" + "01571" + "01495" + "00079" + "00185" + "57630",
            "00480" + "02880" + "07480" + "34480" + "87896" + "22582" + "00480"
        };

        private readonly int width, height, stride;
        private readonly IntPtr scan;
        private readonly byte[] rowPixels;

        private sealed class Glyph
        {
            public readonly Rectangle Bounds;
            public readonly bool[] Ink;

            public Glyph(Rectangle bounds, List<int> points, Rectangle region)
            {
                Ink = new bool[bounds.Width * bounds.Height];
                foreach (int point in points)
                    Ink[(point / region.Width - bounds.Top) * bounds.Width + point % region.Width - bounds.Left] = true;
                bounds.Offset(region.Location);
                Bounds = bounds;
            }

            public Glyph(Rectangle bounds, bool[] ink)
            {
                Bounds = bounds;
                Ink = ink;
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

        public Counter[] Read(Rectangle panelRegion)
        {
            var imageBounds = new Rectangle(0, 0, width, height);
            List<Glyph> glyphs = FindGlyphs(imageBounds, 130);
            var counters = new List<Counter>();
            for (int i = 0; i < glyphs.Count; i++)
            {
                Glyph slash = glyphs[i];
                Rectangle box = slash.Bounds;
                Counter counter;
                if (IsSlash(slash) && OnDarkPlaque(box))
                {
                    counter = ReadAtSlash(glyphs, i, box);
                    if (counter == null)
                        counter = ReadFaintDigits(box, imageBounds);
                    if (counter == null)
                        counter = ReadMixedContrastCounter(box, glyphs, i, imageBounds);
                }
                else
                {
                    Glyph left;
                    Glyph separatedSlash;
                    if (!SplitJoinedSlash(slash, out left, out separatedSlash)) continue;
                    box = separatedSlash.Bounds;
                    if (!IsSlash(separatedSlash) || left.Bounds.Top <= box.Top ||
                        !IsAdjacentDigit(left.Bounds, box, -1) || !OnDarkPlaque(box)) continue;
                    counter = ReadCounter(box, left, FindAdjacentDigit(glyphs, i, box, 1));
                }
                if (counter != null) counters.Add(counter);
            }
            if (!counters.Exists(c => panelRegion.Contains(c.Bounds)))
            {
                Counter dim = ReadCoveredCounter(panelRegion);
                if (dim != null) counters.Add(dim);
            }
            return counters.ToArray();
        }

        public Counter ReadCoveredCounter(Rectangle region)
        {
            region.Intersect(new Rectangle(0, 0, width, height));
            if (region.IsEmpty || region.Width < 4 * MinSlashHeight || region.Height < MinSlashHeight)
                return null;

            // A translucent tooltip leaves the plaque lettering dimmer than its own text.
            // Accept only one fraction read at the same position in both contrast bands.
            Counter dim = ReadDimPanel(region, 32, 102);
            Counter check = dim == null ? null : ReadDimPanel(region, 44, 94);
            if (SameCounter(dim, check)) return dim;

            foreach (int foregroundInk in new[] { 100, 92 })
            {
                // Video compression can darken the tooltip strokes.
                dim = new DimPlaque(this, region, 34, foregroundInk).Read();
                if (dim == null) continue;
                check = new DimPlaque(this, region, 40, foregroundInk).Read(dim);
                if (SameCounter(dim, check)) return dim;
            }
            return null;
        }

        private static bool SameCounter(Counter first, Counter second)
        {
            if (first == null || second == null || first.Text != second.Text) return false;
            Rectangle shared = Rectangle.Intersect(first.Bounds, second.Bounds);
            return shared.Width * shared.Height >= .8 *
                Math.Max(first.Bounds.Width * first.Bounds.Height, second.Bounds.Width * second.Bounds.Height);
        }

        private sealed class DimPlaque
        {
            private const byte Dark = 1, Ink = 2, Covered = 3;
            private readonly Rectangle region;
            private readonly byte[] mask;
            private readonly int pitch;
            private readonly Dictionary<Rectangle, double[]> digitScores = new Dictionary<Rectangle, double[]>();
            private readonly int[] ink = new int[35], visible = new int[35];

            public DimPlaque(CounterImage image, Rectangle region, int minInk, int foregroundInk)
            {
                this.region = region;
                pitch = region.Width;
                mask = new byte[pitch * region.Height];
                var bright = new List<int>();
                for (int y = 0; y < region.Height; y++)
                {
                    Marshal.Copy(IntPtr.Add(image.scan, (region.Top + y) * image.stride + region.Left * 3),
                        image.rowPixels, 0, pitch * 3);
                    for (int x = 0; x < pitch; x++)
                    {
                        int i = x * 3;
                        int low = Math.Min(image.rowPixels[i], Math.Min(image.rowPixels[i + 1], image.rowPixels[i + 2]));
                        int high = Math.Max(image.rowPixels[i], Math.Max(image.rowPixels[i + 1], image.rowPixels[i + 2]));
                        int point = y * pitch + x;
                        if (low >= foregroundInk) bright.Add(point);
                        else if (high < 27) mask[point] = Dark;
                        else if (low >= minInk && high < foregroundInk && high - low < 44) mask[point] = Ink;
                    }
                }
                // Include the immediate antialiased fringe of the brighter tooltip letters.
                foreach (int p in bright)
                {
                    mask[p] = Covered;
                    if (p % pitch > 0) mask[p - 1] = Covered;
                    if (p % pitch < pitch - 1) mask[p + 1] = Covered;
                    if (p >= pitch) mask[p - pitch] = Covered;
                    if (p < mask.Length - pitch) mask[p + pitch] = Covered;
                }
            }

            public Counter Read(Counter first = null)
            {
                Counter match = null;
                double bestError = double.PositiveInfinity;
                var tried = new HashSet<Rectangle>();
                var search = Rectangle.FromLTRB(2, 1, pitch - 2, region.Height - 1);
                int minHeight = MinSlashHeight, maxHeight = Math.Min(MaxSlashHeight, pitch / 4);
                if (first != null)
                {
                    int margin = Math.Max(2, first.SlashHeight / 6);
                    var local = Rectangle.Inflate(first.Bounds, margin, margin);
                    local.Offset(-region.Left, -region.Top);
                    search.Intersect(local);
                    minHeight = Math.Max(minHeight, first.SlashHeight - margin);
                    maxHeight = Math.Min(maxHeight, first.SlashHeight + margin);
                }
                for (int y = search.Top; y < search.Bottom; y++)
                    for (int x = search.Left; x < search.Right; x++)
                    {
                        if (At(x, y) != Ink) continue;
                        for (int direction = -1; direction <= 1; direction += 2)
                        {
                            // Start at a visible endpoint. The other tip may be capped by foreground.
                            int beyond = y - direction;
                            if (At(x - 1, beyond) == Ink || At(x, beyond) == Ink || At(x + 1, beyond) == Ink) continue;
                            for (int h = minHeight; h <= maxHeight; h++)
                                for (int shift = (int)Math.Round(.17 * h); shift <= Math.Round(.25 * h); shift++)
                                {
                                    int top = direction == 1 ? y : y - h + 1;
                                    int topX = direction == 1 ? x : x + shift;
                                    int bottomX = topX - shift;
                                    if (top < 1 || top + h >= region.Height ||
                                        bottomX - 2 * h < 0 || topX + 2 * h >= pitch) continue;
                                    if (!SlashFits(top, h, topX, bottomX)) continue;
                                    var slash = Rectangle.FromLTRB(bottomX - Math.Max(1, (int)Math.Round(.025 * h)), top,
                                        topX + Math.Max(2, (int)Math.Round(.06 * h)), top + h);
                                    if (!tried.Add(slash) || !HasDarkSides(slash)) continue;
                                    Rectangle left, right;
                                    double leftError, rightError;
                                    int current = ReadDigit(slash, -1, out left, out leftError);
                                    if (current < 0) continue;
                                    int capacity = ReadDigit(slash, 1, out right, out rightError);
                                    if (capacity <= 0 || current > capacity ||
                                        Math.Abs(left.Top - right.Top) > .10 * h ||
                                        Math.Abs(left.Bottom - right.Bottom) > .12 * h) continue;
                                    Rectangle bounds = Rectangle.Union(slash, Rectangle.Union(left, right));
                                    bounds.Offset(region.Location);
                                    var candidate = new Counter(current, capacity, bounds, h, false, false);
                                    if (match != null)
                                    {
                                        Rectangle shared = Rectangle.Intersect(match.Bounds, candidate.Bounds);
                                        if (match.Text != candidate.Text || shared.Width * shared.Height < .6 *
                                            Math.Max(match.Bounds.Width * match.Bounds.Height, candidate.Bounds.Width * candidate.Bounds.Height))
                                            return null;
                                    }
                                    if (leftError + rightError >= bestError) continue;
                                    bestError = leftError + rightError;
                                    match = candidate;
                                }
                        }
                    }
                return match;
            }

            private byte At(int x, int y) { return mask[y * pitch + x]; }

            private bool SlashFits(int top, int h, int topX, int bottomX)
            {
                int radius = Math.Max(1, (int)Math.Round(.045 * h));
                byte upper = At(topX, top), lower = At(bottomX, top + h - 1);
                if (upper == Dark || lower == Dark ||
                    At(topX, top - 1) == Ink || At(bottomX, top + h) == Ink) return false;
                int hits = 0, gaps = 0, wide = 0;
                for (int dy = 0; dy < h; dy++)
                {
                    int y = top + dy, x = topX - ((topX - bottomX) * dy + h / 2) / (h - 1);
                    bool ink = false, covered = false;
                    for (int dx = -radius; dx <= radius; dx++)
                    {
                        byte pixel = At(x + dx, y);
                        ink |= pixel == Ink;
                        covered |= pixel == Covered;
                    }
                    if (ink)
                    {
                        hits++;
                        if (At(x - radius - 1, y) == Ink && At(x + radius + 1, y) == Ink) wide++;
                    }
                    else if (!covered) gaps++;
                    if (gaps > .10 * h || wide > .20 * h) return false;
                }
                return hits >= .48 * h;
            }

            private bool HasDarkSides(Rectangle slash)
            {
                int h = slash.Height;
                for (int side = -1; side <= 1; side += 2)
                {
                    int dark = 0, ink = 0, count = 0;
                    for (int y = slash.Top; y < slash.Bottom; y++)
                        for (int dx = (int)(.95 * h); dx <= 1.4 * h; dx++)
                        {
                            byte p = At(slash.Left + slash.Width / 2 + side * dx, y);
                            if (p == Dark) dark++;
                            if (p == Ink) ink++;
                            count++;
                        }
                    if (dark < .35 * count || dark < 4 * ink) return false;
                }
                return true;
            }

            private int ReadDigit(Rectangle slash, int direction, out Rectangle bounds, out double bestError)
            {
                int h = slash.Height;
                var errors = new double[Digits.Length];
                var boxes = new Rectangle[Digits.Length];
                for (int i = 0; i < errors.Length; i++) errors[i] = 1;
                for (int y = slash.Top + (int)Math.Round(.055 * h); y <= slash.Top + Math.Round(.16 * h); y++)
                    for (int dh = (int)Math.Round(.64 * h); dh <= Math.Round(.79 * h); dh++)
                        for (int dw = (int)Math.Round(.15 * h); dw <= Math.Round(.53 * h); dw++)
                        {
                            bool narrow = dw <= Math.Round(.28 * h);
                            if (!narrow && dw < Math.Round(.35 * h)) continue;
                            for (int gap = (int)Math.Round(-.03 * h); gap <= Math.Round((narrow ? .18 : .135) * h); gap++)
                            {
                                int x = direction < 0 ? slash.Left - gap - dw : slash.Right + gap;
                                var box = new Rectangle(x, y, dw, dh);
                                double[] scores;
                                if (!digitScores.TryGetValue(box, out scores))
                                {
                                    scores = ScoreDigit(box);
                                    // Nearby slash hypotheses reuse most of the same digit rectangles.
                                    if (digitScores.Count >= 32768) digitScores.Clear();
                                    digitScores.Add(box, scores);
                                }
                                if (scores == null || (narrow && !IsNarrowDigit(box, h, direction))) continue;
                                for (int digit = 0; digit < errors.Length; digit++)
                                {
                                    if (narrow != (digit == 1) || scores[digit] >= errors[digit]) continue;
                                    errors[digit] = scores[digit];
                                    boxes[digit] = box;
                                }
                            }
                        }
                int best = 0;
                for (int digit = 1; digit < errors.Length; digit++)
                    if (errors[digit] < errors[best]) best = digit;
                bounds = boxes[best];
                bestError = errors[best];
                if (bestError > .135) return -1;
                for (int digit = 0; digit < errors.Length; digit++)
                    if (digit != best && errors[digit] - bestError < .042) return -1;
                return best;
            }

            private bool IsNarrowDigit(Rectangle box, int slashHeight, int direction)
            {
                // A visible slice of a wider digit can resemble a stem. Check for ink beyond
                // the outer edge, away from the slash.
                int extraInk = 0;
                int edge = direction < 0 ? box.Left : box.Right - 1;
                for (int row = box.Top; row < box.Bottom; row++)
                    for (int distance = 2; distance <= .23 * slashHeight; distance++)
                        if (At(edge + direction * distance, row) == Ink) extraInk++;
                return extraInk <= .08 * box.Width * box.Height;
            }

            private double[] ScoreDigit(Rectangle box)
            {
                Array.Clear(ink, 0, ink.Length);
                Array.Clear(visible, 0, visible.Length);
                int inkCount = 0, visibleCount = 0, topInk = 0;
                for (int sy = 0; sy < 28; sy++)
                {
                    int row = (box.Top + (2 * sy + 1) * box.Height / 56) * pitch + box.Left;
                    for (int sx = 0; sx < 20; sx++)
                    {
                        byte p = mask[row + (2 * sx + 1) * box.Width / 40];
                        if (p != Dark && p != Ink) continue;
                        int cell = sy / 4 * 5 + sx / 4;
                        visible[cell]++;
                        visibleCount++;
                        if (p != Ink) continue;
                        ink[cell]++;
                        inkCount++;
                        if (sy < 12) topInk++;
                    }
                }
                if (visibleCount < 224 || inkCount < .20 * visibleCount ||
                    topInk < 12 || inkCount - topInk < 12) return null;
                int edgeInk = 0;
                for (int row = box.Top; row < box.Bottom; row++)
                {
                    if (At(box.Left - 1, row) == Ink) edgeInk++;
                    if (At(box.Right, row) == Ink) edgeInk++;
                }
                for (int col = box.Left; col < box.Right; col++)
                {
                    if (At(col, box.Top - 1) == Ink) edgeInk++;
                    if (At(col, box.Bottom) == Ink) edgeInk++;
                }
                var scores = new double[Digits.Length];
                double edgeError = .5 * edgeInk / (box.Width * box.Height);
                for (int digit = 0; digit < scores.Length; digit++)
                {
                    double error = Math.Min(VisibleDigitError(ink, visible, Digits[digit]),
                        VisibleDigitError(ink, visible, PlaqueDigits[digit]));
                    if (digit == 1) error = Math.Min(error, VisibleDigitError(ink, visible, OneRightStem));
                    scores[digit] = error / visibleCount + edgeError;
                }
                return scores;
            }
        }

        private Counter ReadDimPanel(Rectangle region, int minInk, int maxInk)
        {
            var glyphs = FindGlyphs(region, minInk, maxInk);
            Counter match = null;
            for (int i = 0; i < glyphs.Count; i++)
            {
                Glyph top = glyphs[i];
                if (top.Bounds.Height < MinSlashHeight || top.Bounds.Width > .43 * top.Bounds.Height) continue;
                Counter candidate = null;
                if (IsSlash(top) && OnDarkPlaque(top.Bounds))
                    candidate = ReadAtSlash(glyphs, i, top.Bounds, true);
                if (candidate == null) candidate = ReadBehindForeground(glyphs, i, minInk, maxInk);
                if (candidate == null) continue;
                if (match != null) return null;
                match = candidate;
            }
            return match;
        }

        private Counter ReadAtSlash(List<Glyph> glyphs, int index, Rectangle slash, bool panelOnly = false)
        {
            return ReadCounter(slash, FindAdjacentDigit(glyphs, index, slash, -1),
                FindAdjacentDigit(glyphs, index, slash, 1), panelOnly);
        }

        private Counter ReadBehindForeground(List<Glyph> glyphs, int index, int minInk, int maxInk)
        {
            // The brighter foreground can cut the diagonal into two strokes.
            // Require both tips, foreground ink across the gap and dark plaque on either side.
            Glyph top = glyphs[index];
            Counter match = null;
            for (int j = index - 1; j >= 0; j--)
            {
                Rectangle lower = glyphs[j].Bounds;
                if (top.Bounds.Left - lower.Left > MaxSlashHeight * .35) break;
                int gap = lower.Top - top.Bounds.Bottom;
                Rectangle both = Rectangle.Union(top.Bounds, lower);
                if (gap <= 0 || gap > both.Height * .22 || both.Height > MaxSlashHeight ||
                    lower.Height < both.Height * .16 || lower.Height > top.Bounds.Height) continue;
                Glyph stroke = JoinStrokes(top, glyphs[j], both);
                Counter candidate = null;
                if (IsSlash(stroke, IsForegroundInk) &&
                    Sample(both, -1.8, -.37, -.8, -.20, IsDark) >= .85 &&
                    Sample(both, .8, -.37, 1.8, -.20, IsDark) >= .85)
                    candidate = ReadAtSlash(glyphs, index, both, true);
                if (candidate == null && HasCoveredSlashEdge(stroke))
                    candidate = ReadCoveredDigits(both, minInk, maxInk);
                if (candidate == null) continue;
                if (match != null) return null;
                match = candidate;
            }
            return match;
        }

        private static Glyph JoinStrokes(Glyph top, Glyph bottom, Rectangle bounds)
        {
            var ink = new bool[bounds.Width * bounds.Height];
            foreach (Glyph part in new[] { top, bottom })
                for (int y = 0; y < part.Bounds.Height; y++)
                    Array.Copy(part.Ink, y * part.Bounds.Width, ink,
                        (part.Bounds.Top - bounds.Top + y) * bounds.Width + part.Bounds.Left - bounds.Left, part.Bounds.Width);
            return new Glyph(bounds, ink);
        }

        private bool IsForegroundInk(int x, int y)
        {
            if (x < 0 || x >= width) return false;
            Marshal.Copy(IntPtr.Add(scan, y * stride + x * 3), rowPixels, 0, 3);
            return Math.Min(rowPixels[0], Math.Min(rowPixels[1], rowPixels[2])) >= 103;
        }

        private bool HasCoveredSlashEdge(Glyph stroke)
        {
            // Foreground along one side can shave off the slash without changing its opposite edge.
            Rectangle box = stroke.Bounds;
            int w = box.Width, h = box.Height;
            if (w < .15 * h || w > .43 * h) return false;
            var ends = new int[h];
            int coveredRows = 0;
            for (int y = 0; y < h; y++)
            {
                int start = 0, end = w - 1;
                while (end >= 0 && !stroke.Ink[y * w + end]) end--;
                ends[y] = end;
                if (end < 0) { coveredRows++; continue; }
                while (!stroke.Ink[y * w + start]) start++;
                if (end - start + 1 > Math.Max(2, h * .19)) return false;
            }
            double shift = ends[0] - ends[h - 1];
            if (shift < h * .12 || shift > h * .35 || coveredRows == 0) return false;
            for (int y = 1; y < h - 1; y++)
            {
                double edge = ends[0] - shift * y / (h - 1);
                if (ends[y] >= 0)
                {
                    if (Math.Abs(ends[y] - edge) > Math.Max(1.4, h * .06)) return false;
                }
                else
                {
                    int x = box.Left + (int)Math.Round(edge);
                    if (!IsForegroundInk(x, box.Top + y) && !IsForegroundInk(x - 1, box.Top + y) &&
                        !IsForegroundInk(x - 2, box.Top + y)) return false;
                }
            }
            return true;
        }

        private Counter ReadCoveredDigits(Rectangle slash, int minInk, int maxInk)
        {
            int h = slash.Height;
            // The dim text is still framed by the dark plaque above and below the foreground.
            if (!(Sample(slash, -1.1, -.60, 1.1, -.38, IsDark) >= .80 &&
                  Sample(slash, -1.1, .40, 1.1, .54, IsDark) >= .80)) return null;
            var region = Rectangle.Inflate(slash, h, 0);
            if (region.Left < 0 || region.Right > width) return null;
            var pixels = new byte[region.Width * h];
            for (int y = 0; y < h; y++)
            {
                Marshal.Copy(IntPtr.Add(scan, (region.Top + y) * stride + region.Left * 3), rowPixels, 0, region.Width * 3);
                for (int x = 0; x < region.Width; x++)
                {
                    int i = x * 3;
                    int low = Math.Min(rowPixels[i], Math.Min(rowPixels[i + 1], rowPixels[i + 2]));
                    int high = Math.Max(rowPixels[i], Math.Max(rowPixels[i + 1], rowPixels[i + 2]));
                    // Use only definite dark background or dim ink. Foreground is missing evidence.
                    if (high < 27) pixels[y * region.Width + x] = 1;
                    else if (low >= minInk && high <= maxInk && high - low < 44)
                        pixels[y * region.Width + x] = 2;
                }
            }
            Rectangle left, right;
            int current = ReadCoveredDigit(pixels, region.Width, slash, -1, out left);
            int capacity = ReadCoveredDigit(pixels, region.Width, slash, 1, out right);
            if (capacity <= 0 || current < 0 || current > capacity ||
                Math.Abs(left.Top - right.Top) > .10 * h || Math.Abs(left.Bottom - right.Bottom) > .12 * h)
                return null;
            Rectangle bounds = Rectangle.Union(slash, Rectangle.Union(left, right));
            return new Counter(current, capacity, bounds, h, false, false);
        }

        private static int ReadCoveredDigit(byte[] pixels, int pitch, Rectangle slash, int direction, out Rectangle bounds)
        {
            int h = slash.Height;
            var errors = new double[Digits.Length];
            var boxes = new Rectangle[Digits.Length];
            for (int i = 0; i < errors.Length; i++) errors[i] = 1;
            var ink = new int[35];
            var visible = new int[35];
            for (int y = (int)Math.Round(.04 * h); y <= Math.Round(.15 * h); y++)
                for (int dh = (int)Math.Round(.69 * h); dh <= Math.Round(.79 * h); dh++)
                    for (int dw = (int)Math.Round(.21 * h); dw <= Math.Round(.53 * h); dw++)
                    {
                        bool narrow = dw <= Math.Round(.37 * h);
                        if (!narrow && dw < Math.Round(.40 * h)) continue;
                        for (int gap = (int)Math.Round(-.07 * h); gap <= Math.Round(.15 * h); gap++)
                        {
                            int x = direction < 0 ? h - gap - dw : h + slash.Width + gap;
                            Array.Clear(ink, 0, ink.Length);
                            Array.Clear(visible, 0, visible.Length);
                            int inkCount = 0, visibleCount = 0, topInk = 0, bottomInk = 0;
                            for (int sy = 0; sy < 28; sy++)
                                for (int sx = 0; sx < 20; sx++)
                                {
                                    int cell = sy / 4 * 5 + sx / 4;
                                    int offset = (y + (2 * sy + 1) * dh / 56) * pitch + x + (2 * sx + 1) * dw / 40;
                                    byte pixel = pixels[offset];
                                    if (pixel == 0) continue;
                                    visible[cell]++;
                                    visibleCount++;
                                    if (pixel != 2) continue;
                                    ink[cell]++;
                                    inkCount++;
                                    if (sy < 12) topInk++;
                                    if (sy >= 16) bottomInk++;
                                }
                            if (visibleCount < 280 || inkCount < .20 * visibleCount || topInk < 14 || bottomInk < 14) continue;
                            for (int digit = 0; digit < errors.Length; digit++)
                            {
                                if (narrow != (digit == 1)) continue;
                                double error = VisibleDigitError(ink, visible, Digits[digit]) / visibleCount;
                                if (digit == 1)
                                    error = Math.Min(error, VisibleDigitError(ink, visible, OneRightStem) / visibleCount);
                                if (error >= errors[digit]) continue;
                                errors[digit] = error;
                                boxes[digit] = new Rectangle(slash.Left - h + x, slash.Top + y, dw, dh);
                            }
                        }
                    }
            int best = 0;
            for (int digit = 1; digit < errors.Length; digit++)
                if (errors[digit] < errors[best]) best = digit;
            bounds = boxes[best];
            if (errors[best] > .17) return -1;
            for (int digit = 0; digit < errors.Length; digit++)
                if (digit != best && errors[digit] - errors[best] < .075) return -1;
            return best;
        }

        private static double VisibleDigitError(int[] ink, int[] visible, string template)
        {
            double error = 0;
            for (int i = 0; i < ink.Length; i++)
                error += Math.Abs(ink[i] - visible[i] * (template[i] - '0') / 9.0);
            return error;
        }

        private static bool IsDark(int r, int g, int b) { return Math.Max(r, Math.Max(g, b)) < 34; }

        private Counter ReadCounter(Rectangle slash, Glyph left, Glyph right, bool panelOnly = false)
        {
            if (left == null || right == null) return null;
            int current = ReadDigit(left), capacity = ReadDigit(right);
            if (capacity < 0 || current < 0 || current > capacity) return null;
            Rectangle bounds = Rectangle.Union(left.Bounds, Rectangle.Union(slash, right.Bounds));
            bool hud = !panelOnly && HasHudCards(slash);
            // An empty HUD stack can show 0/0. The panel always has a positive capacity.
            if (capacity == 0 && !hud) return null;
            bool hasTrim = !panelOnly && !hud && HasPlaqueRail(slash, -.89, -.58) && HasPlaqueRail(slash, .34, .72);
            return new Counter(current, capacity, bounds, slash.Height,
                hud, hasTrim && IsIsolatedPlaque(slash), hasTrim);
        }

        private Counter ReadFaintDigits(Rectangle slash, Rectangle imageBounds)
        {
            // Video compression can erase part of a digit at the main threshold.
            // Retry only around a physically verified slash, and keep the same shape checks.
            var region = Rectangle.Intersect(imageBounds, Rectangle.Inflate(slash, slash.Height, slash.Height / 4));
            var glyphs = FindGlyphs(region, 110);
            Counter match = null;
            for (int i = 0; i < glyphs.Count; i++)
            {
                Glyph glyph = glyphs[i];
                Rectangle box = glyph.Bounds;
                if (!box.Contains(slash) || box.Width - slash.Width > 2 || box.Height - slash.Height > 2 ||
                    !IsSlash(glyph) || !OnDarkPlaque(box)) continue;
                Counter counter = ReadAtSlash(glyphs, i, box);
                if (counter == null) continue;
                if (match != null) return null;
                match = counter;
            }
            return match;
        }

        private Counter ReadMixedContrastCounter(Rectangle slash, List<Glyph> glyphs, int index, Rectangle imageBounds)
        {
            // A tooltip edge can dim only one digit and leave the slash and the
            // other digit visible. Look for a complete second digit in both bands.
            Glyph left = FindAdjacentDigit(glyphs, index, slash, -1);
            Glyph right = FindAdjacentDigit(glyphs, index, slash, 1);
            if ((left == null) == (right == null) ||
                !HasPlaqueRail(slash, -.89, -.58) || !HasPlaqueRail(slash, .34, .72)) return null;
            Glyph bright = left ?? right;
            int direction = left == null ? -1 : 1;
            var region = Rectangle.Intersect(imageBounds, Rectangle.Inflate(slash, slash.Height, 0));
            Glyph dim = FindDimDigit(region, slash, bright.Bounds, direction, 66);
            Glyph check = dim == null ? null : FindDimDigit(region, slash, bright.Bounds, direction, 76);
            Counter candidate = ReadCounter(slash, left ?? dim, right ?? dim, true);
            Counter verification = ReadCounter(slash, left ?? check, right ?? check, true);
            return SameCounter(candidate, verification) ? candidate : null;
        }

        private Glyph FindDimDigit(Rectangle region, Rectangle slash, Rectangle bright, int direction, int minInk)
        {
            Glyph match = null;
            foreach (Glyph glyph in FindGlyphs(region, minInk, 129))
            {
                Rectangle box = glyph.Bounds;
                if (box.Left <= region.Left || box.Right >= region.Right ||
                    !IsAdjacentDigit(box, slash, direction) ||
                    Math.Abs(box.Top - bright.Top) > slash.Height * .10 ||
                    Math.Abs(box.Bottom - bright.Bottom) > slash.Height * .12) continue;
                if (match != null) return null;
                match = glyph;
            }
            return match;
        }

        private static bool SplitJoinedSlash(Glyph joined, out Glyph left, out Glyph slash)
        {
            left = slash = null;
            int w = joined.Bounds.Width, h = joined.Bounds.Height;
            if (h < MinSlashHeight || w <= h * .43 || w > h * .85) return false;
            int maxStrokeWidth = Math.Max(2, (int)(h * .19));
            var remaining = (bool[])joined.Ink.Clone();
            var stroke = new bool[remaining.Length];
            int joinedRows = 0;
            for (int y = 0; y < h; y++)
            {
                int row = y * w, x = w - 1;
                while (x >= 0 && !joined.Ink[row + x]) x--;
                for (int end = x; x >= 0 && x > end - maxStrokeWidth && joined.Ink[row + x]; x--)
                {
                    remaining[row + x] = false;
                    stroke[row + x] = true;
                }
                if (x >= 0 && joined.Ink[row + x]) joinedRows++;
            }
            // A touching digit can join the tall slash at its base. Recover only the
            // right-hand ink, leaving both glyphs subject to the usual shape checks.
            if (joinedRows == 0 || joinedRows > Math.Max(1, h / 7)) return false;
            slash = TrimInk(joined.Bounds, stroke);
            left = TrimInk(joined.Bounds, remaining);
            return left != null && slash != null;
        }

        private static Glyph TrimInk(Rectangle bounds, bool[] ink)
        {
            int left = bounds.Width, top = bounds.Height, right = 0, bottom = 0;
            for (int y = 0; y < bounds.Height; y++)
                for (int x = 0; x < bounds.Width; x++)
                    if (ink[y * bounds.Width + x])
                    {
                        left = Math.Min(left, x); right = Math.Max(right, x + 1);
                        top = Math.Min(top, y); bottom = Math.Max(bottom, y + 1);
                    }
            if (left >= right || top >= bottom) return null;
            var box = new Rectangle(bounds.X + left, bounds.Y + top, right - left, bottom - top);
            var tightInk = new bool[box.Width * box.Height];
            for (int y = 0; y < box.Height; y++)
                Array.Copy(ink, (y + top) * bounds.Width + left, tightInk, y * box.Width, box.Width);
            return new Glyph(box, tightInk);
        }

        private List<Glyph> FindGlyphs(Rectangle region, int minInk, int maxInk = 255)
        {
            var unvisited = new byte[region.Width * region.Height];
            bool sawInk = false, sawDark = false;
            for (int y = 0; y < region.Height; y++)
            {
                Marshal.Copy(IntPtr.Add(scan, (y + region.Top) * stride + region.Left * 3), rowPixels, 0, region.Width * 3);
                for (int x = 0; x < region.Width; x++)
                {
                    int offset = x * 3;
                    int b = rowPixels[offset], g = rowPixels[offset + 1], r = rowPixels[offset + 2];
                    int low = Math.Min(r, Math.Min(g, b));
                    int high = Math.Max(r, Math.Max(g, b));
                    if (high < 34) sawDark = true;
                    if (low >= minInk && high <= maxInk && high - low < 44)
                    {
                        unvisited[y * region.Width + x] = 1;
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
                int left = region.Width, right = 0, top = region.Height, bottom = 0;
                while (pending.Count > 0)
                {
                    int point = pending.Dequeue(), x = point % region.Width, y = point / region.Width;
                    left = Math.Min(left, x); right = Math.Max(right, x);
                    top = Math.Min(top, y); bottom = Math.Max(bottom, y);
                    if (right - left < MaxSlashHeight && bottom - top < MaxSlashHeight) points.Add(point);
                    // Four-connected strokes keep adjacent slash and digit corners separate.
                    if (x > 0) Visit(point - 1, unvisited, pending);
                    if (x + 1 < region.Width) Visit(point + 1, unvisited, pending);
                    if (y > 0) Visit(point - region.Width, unvisited, pending);
                    if (y + 1 < region.Height) Visit(point + region.Width, unvisited, pending);
                }
                int glyphWidth = right - left + 1, glyphHeight = bottom - top + 1;
                if (glyphHeight >= 6 && glyphHeight <= MaxSlashHeight &&
                    glyphWidth >= 2 && glyphWidth < glyphHeight && points.Count >= glyphHeight)
                    glyphs.Add(new Glyph(Rectangle.FromLTRB(left, top, right + 1, bottom + 1), points, region));
            }
            glyphs.Sort((a, b) => a.Bounds.Left.CompareTo(b.Bounds.Left));
            return glyphs;
        }

        private static void Visit(int point, byte[] unvisited, Queue<int> pending)
        {
            if (unvisited[point] == 0) return;
            unvisited[point] = 0;
            pending.Enqueue(point);
        }

        private static bool IsSlash(Glyph glyph, Func<int, int, bool> covered = null)
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
                if (ink == 0 && covered != null) { centers[y] = double.NaN; continue; }
                if (ink == 0 || ink != end - start + 1 || ink > Math.Max(2.0, h * .19)) return false;
                centers[y] = (start + end) / 2.0;
            }
            double shift = centers[0] - centers[h - 1];
            if (shift < h * .12 || shift > h * .35) return false;
            for (int y = 1; y < h - 1; y++)
            {
                double expected = centers[0] - shift * y / (h - 1);
                if (double.IsNaN(centers[y]))
                {
                    if (!covered(glyph.Bounds.Left + (int)Math.Round(expected), glyph.Bounds.Top + y)) return false;
                }
                else if (Math.Abs(centers[y] - expected) > Math.Max(1.4, h * .07))
                    return false;
            }
            return true;
        }

        private static bool IsAdjacentDigit(Rectangle box, Rectangle slash, int direction)
        {
            double h = slash.Height;
            int gap = direction < 0 ? slash.Left - box.Right : box.Left - slash.Right;
            return gap >= -h * .12 && gap <= h * .23 &&
                box.Height >= h * .50 && box.Height <= h * .87 &&
                box.Top >= slash.Top && box.Top - slash.Top <= h * .22 &&
                slash.Bottom - box.Bottom >= h * .06 && slash.Bottom - box.Bottom <= h * .39;
        }

        private static Glyph FindAdjacentDigit(List<Glyph> glyphs, int slashIndex, Rectangle slash, int direction)
        {
            Glyph match = null;
            for (int i = slashIndex + direction; i >= 0 && i < glyphs.Count; i += direction)
            {
                Rectangle box = glyphs[i].Bounds;
                if (Math.Abs(box.Left - slash.Left) > slash.Height * .95) break;
                if (!IsAdjacentDigit(box, slash, direction)) continue;
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
            // Sample the plaque face next to the digits. The decorated sides
            // can start inside the wider sampling area on some UI scales.
            return Sample(slash, -1.4, -.37, -.8, .35, IsDark) >= .85 &&
                Sample(slash, .8, -.37, 1.4, .35, IsDark) >= .85;
        }

        private bool HasHudCards(Rectangle slash)
        {
            // The HUD plaque sits directly above the light-edged, blue stack of cards.
            Func<int, int, int, bool> blue = (r, g, b) => b >= 65 && b - r >= 23 && b - g >= 10;
            Func<int, int, int, bool> pale = (r, g, b) => b > 120 && r > 90 && g > 90;
            if (!(Sample(slash, -.7, 2.2, .7, 3.3, blue) >= .74)) return false;
            if (Sample(slash, -1.55, 2.2, -1.15, 3.3, blue) <= .30 &&
                Sample(slash, -1, 1.45, .7, 2.15, pale) >= .35) return true;
            // Compressed or short slash masks shift the normalized card edge down and out.
            return Sample(slash, -2.0, 2.2, -1.65, 3.3, blue) <= .20 &&
                Sample(slash, 1.65, 2.2, 2.0, 3.3, blue) <= .20 &&
                Sample(slash, -1.0, 1.67, .7, 2.41, pale) >= .55;
        }

        private bool IsIsolatedPlaque(Rectangle slash)
        {
            double h = slash.Height, x = slash.Left + slash.Width / 2.0, y = slash.Top + h / 2;
            // A counter-only diagnostic crop must tightly frame one centered plaque with visible trim.
            return width >= 4.5 * h && width <= 7 * h && height >= 1.75 * h && height <= 2.6 * h &&
                Math.Abs(x - width / 2.0) <= width * .12 && Math.Abs(y - height / 2.0) <= height * .12;
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
        return Prepare(png, maxDimension, region, 2.0);
    }

    public static FateOcrImage Prepare(byte[] png, int maxDimension, Rectangle region, double targetScale)
    {
        return Prepare(png, maxDimension, region, targetScale, Ink.Original);
    }

    // Card captions use pale lettering on mottled parchment. Estimate the local
    // background and invert the remaining strokes for the small-text OCR pass.
    public static FateOcrImage PrepareCaption(byte[] png, int maxDimension, Rectangle region)
    {
        return Prepare(png, maxDimension, region, 3.0, Ink.Light);
    }

    public static FateOcrImage PrepareNameplate(byte[] png, int maxDimension, Rectangle region)
    {
        return Prepare(png, maxDimension, region, 4.0, Ink.Dark);
    }

    public static FateOcrImage PrepareCoveredNameplate(byte[] png, int maxDimension, Rectangle region)
    {
        return Prepare(png, maxDimension, region, 2.0, Ink.CoveredName);
    }

    public static FateOcrImage PrepareCaptionLine(byte[] png, int maxDimension, Rectangle region)
    {
        return Prepare(png, maxDimension, region, 3.0, Ink.LightLine);
    }

    private enum Ink { Original, Light, Dark, LightLine, CoveredName }

    private static void SubtractBackground(byte[] pixels, int stride, int width, int height, Ink ink)
    {
        int pitch = width + 1;
        int[] sums = new int[pitch * (height + 1)];
        int radius = Math.Max(2, (int)Math.Round(width * .03));
        for (int y = 0; y < height; y++)
        {
            int row = 0;
            for (int x = 0; x < width; x++)
            {
                row += pixels[y * stride + 3 * x];
                sums[(y + 1) * pitch + x + 1] = sums[y * pitch + x + 1] + row;
            }
        }
        for (int y = 0; y < height; y++)
        {
            int top = Math.Max(0, y - radius), bottom = Math.Min(height, y + radius + 1);
            for (int x = 0; x < width; x++)
            {
                int left = Math.Max(0, x - radius), right = Math.Min(width, x + radius + 1);
                int sum = sums[bottom * pitch + right] - sums[top * pitch + right]
                    - sums[bottom * pitch + left] + sums[top * pitch + left];
                int i = y * stride + 3 * x;
                int contrast = pixels[i] - sum / ((right - left) * (bottom - top));
                pixels[i] = (byte)Math.Max(0, ink == Ink.Dark ? -contrast : contrast);
            }
        }
    }

    private static FateOcrImage Prepare(byte[] png, int maxDimension, Rectangle region, double targetScale, Ink ink)
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
                bool localBackground = ink == Ink.Light || ink == Ink.Dark;
                for (int y = 0; y < source.Height; y++)
                    for (int x = 0; x < source.Width; x++)
                    {
                        int offset = y * stride + x * 3;
                        byte value = (byte)((pixels[offset] * 114 + pixels[offset + 1] * 587 + pixels[offset + 2] * 299) / 1000);
                        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = value;
                        if (!localBackground) histogram[value]++;
                    }
                if (localBackground)
                {
                    SubtractBackground(pixels, stride, source.Width, source.Height, ink);
                    for (int y = 0; y < source.Height; y++)
                        for (int x = 0; x < source.Width; x++)
                            histogram[pixels[y * stride + 3 * x]]++;
                }
                int count = source.Width * source.Height, low = 0, high = 255, seen = 0;
                double lowerQuantile = ink == Ink.LightLine ? .35 : .02;
                while (low < 255 && seen + histogram[low] <= count * lowerQuantile) seen += histogram[low++];
                seen = 0;
                // Under a translucent tooltip the title is darker than its plate.
                // Map the median to white so the brighter tooltip text disappears.
                double upperTail = ink == Ink.CoveredName ? .5 : .02;
                while (high > 0 && seen + histogram[high] <= count * upperTail) seen += histogram[high--];
                // Uniform images stay uniform: do not manufacture contrast or text.
                if (high > low || ink != Ink.Original)
                    for (int y = 0; y < source.Height; y++)
                        for (int x = 0; x < source.Width; x++)
                        {
                            int offset = y * stride + x * 3;
                            int stretched = Math.Max(0, Math.Min(255, (pixels[offset] - low) * 255 / Math.Max(1, high - low)));
                            byte value = (byte)(ink == Ink.Original || ink == Ink.CoveredName ? stretched : 255 - stretched);
                            pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = value;
                        }
                Marshal.Copy(pixels, 0, data.Scan0, pixels.Length);
            }
            finally { source.UnlockBits(data); }
            double scale = Math.Min(targetScale, (double)limit / Math.Max(source.Width, source.Height));
            int width = Math.Max(1, (int)Math.Round(source.Width * scale));
            int height = Math.Max(1, (int)Math.Round(source.Height * scale));
            using (var prepared = new Bitmap(width + padding * 2, height + padding * 2, PixelFormat.Format24bppRgb))
            using (var output = new MemoryStream())
            {
                using (var graphics = Graphics.FromImage(prepared))
                {
                    graphics.Clear(ink == Ink.LightLine ? Color.White : source.GetPixel(0, 0));
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
