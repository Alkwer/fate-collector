// Contrast stretching and scaled OCR. Component attribution: THIRD_PARTY_NOTICES.md.
// Fate retains the original PNG and maps every OCR rectangle back to its pixels.
using System;
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
