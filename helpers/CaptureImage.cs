// Adapted from One More Map public/voyage-import.ahk, commit
// 9f704ce8c2b9cb2187c16586f0169227aad72266 (MIT).
// Copyright (c) 2026 one-more-map and contributors.
// See LICENSE.one-more-map.txt. Fate changes: in-memory PNG and strict crop bounds.
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

// Windows.Graphics.Capture at the raw WinRT ABI level (issue #33). GDI's
// CopyFromScreen returns washed-out, non-tone-mapped pixels when Windows
// HDR is on; WGC can read the real float16 scRGB frame and tone-map it
// against the monitor's SDR white level. Every WinRT instance call goes
// through vtable delegates because .NET wraps WinRT objects in projected
// RCWs that refuse ComImport casts (field-tested: RCW casts throw
// InvalidCastException, delegates are pixel-identical to GDI on SDR).
public static class FateScreenCapture
{
    [DllImport("d3d11.dll")]
    private static extern int D3D11CreateDevice(IntPtr adapter, int driverType, IntPtr software, int flags, IntPtr featureLevels, int featureLevelCount, int sdkVersion, out IntPtr device, out int featureLevel, out IntPtr context);

    [DllImport("d3d11.dll")]
    private static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgiDevice, out IntPtr graphicsDevice);

    [DllImport("combase.dll")]
    private static extern int WindowsCreateString([MarshalAs(UnmanagedType.LPWStr)] string src, int length, out IntPtr hstring);

    [DllImport("combase.dll")]
    private static extern int WindowsDeleteString(IntPtr hstring);

    [DllImport("combase.dll")]
    private static extern int RoGetActivationFactory(IntPtr activatableClassId, ref Guid iid, out IntPtr factory);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    public struct SizeInt32 { public int Width; public int Height; }

    [StructLayout(LayoutKind.Sequential)]
    private struct D3D11_TEXTURE2D_DESC
    {
        public uint Width;
        public uint Height;
        public uint MipLevels;
        public uint ArraySize;
        public int Format;
        public uint SampleCount;
        public uint SampleQuality;
        public int Usage;
        public uint BindFlags;
        public uint CPUAccessFlags;
        public uint MiscFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct D3D11_BOX
    {
        public uint Left;
        public uint Top;
        public uint Front;
        public uint Right;
        public uint Bottom;
        public uint Back;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct D3D11_MAPPED_SUBRESOURCE
    {
        public IntPtr Data;
        public uint RowPitch;
        public uint DepthPitch;
    }

    [ComImport]
    [Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IGraphicsCaptureItemInterop
    {
        IntPtr CreateForWindow([In] IntPtr window, [In] ref Guid iid);
        IntPtr CreateForMonitor([In] IntPtr monitor, [In] ref Guid iid);
    }

    // Plain COM (non-WinRT) objects still take ComImport casts fine.
    [ComImport]
    [Guid("DB6F6DDB-AC77-4E88-8253-819DF9BBF140")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ID3D11DeviceAbi
    {
        [PreserveSig] void Slot3_CreateBuffer();
        [PreserveSig] void Slot4_CreateTexture1D();
        [PreserveSig] int CreateTexture2D(ref D3D11_TEXTURE2D_DESC desc, IntPtr initialData, out IntPtr texture);
    }

    [ComImport]
    [Guid("C0BFA96C-E089-44FB-8EAF-26F8796190DA")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ID3D11DeviceContextAbi
    {
        [PreserveSig] void Slot3();
        [PreserveSig] void Slot4();
        [PreserveSig] void Slot5();
        [PreserveSig] void Slot6();
        [PreserveSig] void Slot7();
        [PreserveSig] void Slot8();
        [PreserveSig] void Slot9();
        [PreserveSig] void Slot10();
        [PreserveSig] void Slot11();
        [PreserveSig] void Slot12();
        [PreserveSig] void Slot13();
        [PreserveSig] int Map(IntPtr resource, uint subresource, int mapType, uint flags, out D3D11_MAPPED_SUBRESOURCE mapped);
        [PreserveSig] void Unmap(IntPtr resource, uint subresource);
        [PreserveSig] void Slot16();
        [PreserveSig] void Slot17();
        [PreserveSig] void Slot18();
        [PreserveSig] void Slot19();
        [PreserveSig] void Slot20();
        [PreserveSig] void Slot21();
        [PreserveSig] void Slot22();
        [PreserveSig] void Slot23();
        [PreserveSig] void Slot24();
        [PreserveSig] void Slot25();
        [PreserveSig] void Slot26();
        [PreserveSig] void Slot27();
        [PreserveSig] void Slot28();
        [PreserveSig] void Slot29();
        [PreserveSig] void Slot30();
        [PreserveSig] void Slot31();
        [PreserveSig] void Slot32();
        [PreserveSig] void Slot33();
        [PreserveSig] void Slot34();
        [PreserveSig] void Slot35();
        [PreserveSig] void Slot36();
        [PreserveSig] void Slot37();
        [PreserveSig] void Slot38();
        [PreserveSig] void Slot39();
        [PreserveSig] void Slot40();
        [PreserveSig] void Slot41();
        [PreserveSig] void Slot42();
        [PreserveSig] void Slot43();
        [PreserveSig] void Slot44();
        [PreserveSig] void Slot45();
        [PreserveSig] void CopySubresourceRegion(IntPtr dst, uint dstSubresource, uint dstX, uint dstY, uint dstZ, IntPtr src, uint srcSubresource, ref D3D11_BOX box);
    }

    // Raw vtable delegates for WinRT instance calls (IUnknown slots 0-2,
    // IInspectable slots 3-5, interface methods from slot 6).
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int FnThisOnly(IntPtr thisPtr);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int FnOutPtr(IntPtr thisPtr, out IntPtr result);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int FnOutSize(IntPtr thisPtr, out SizeInt32 result);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int FnPutByte(IntPtr thisPtr, byte value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int FnPtrOutPtr(IntPtr thisPtr, IntPtr arg, out IntPtr result);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int FnCreateFreeThreaded(IntPtr thisPtr, IntPtr device, int pixelFormat, int numberOfBuffers, SizeInt32 size, out IntPtr result);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int FnGetInterface(IntPtr thisPtr, ref Guid iid, out IntPtr result);

    private static Delegate VtableFn(IntPtr obj, int slot, Type delegateType)
    {
        IntPtr vtable = Marshal.ReadIntPtr(obj);
        IntPtr fn = Marshal.ReadIntPtr(vtable, slot * IntPtr.Size);
        return Marshal.GetDelegateForFunctionPointer(fn, delegateType);
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MONITORINFOEX
    {
        public int Size;
        public RECT Monitor;
        public RECT Work;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Device;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromRect(ref RECT rect, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool GetMonitorInfoW(IntPtr hmon, ref MONITORINFOEX info);

    [StructLayout(LayoutKind.Sequential)]
    private struct LUID { public uint LowPart; public int HighPart; }

    [StructLayout(LayoutKind.Sequential)]
    private struct DISPLAYCONFIG_PATH_SOURCE_INFO { public LUID AdapterId; public uint Id; public uint ModeInfoIdx; public uint StatusFlags; }

    [StructLayout(LayoutKind.Sequential)]
    private struct DISPLAYCONFIG_PATH_TARGET_INFO
    {
        public LUID AdapterId;
        public uint Id;
        public uint ModeInfoIdx;
        public uint OutputTechnology;
        public uint Rotation;
        public uint Scaling;
        public uint RefreshRateNumerator;
        public uint RefreshRateDenominator;
        public uint ScanLineOrdering;
        public int TargetAvailable;
        public uint StatusFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DISPLAYCONFIG_PATH_INFO { public DISPLAYCONFIG_PATH_SOURCE_INFO Source; public DISPLAYCONFIG_PATH_TARGET_INFO Target; public uint Flags; }

    [StructLayout(LayoutKind.Sequential, Size = 64)]
    private struct DISPLAYCONFIG_MODE_INFO { public uint InfoType; public uint Id; public LUID AdapterId; }

    [StructLayout(LayoutKind.Sequential)]
    private struct DISPLAYCONFIG_DEVICE_INFO_HEADER { public uint Type; public uint Size; public LUID AdapterId; public uint Id; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DISPLAYCONFIG_SOURCE_DEVICE_NAME
    {
        public DISPLAYCONFIG_DEVICE_INFO_HEADER Header;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string ViewGdiDeviceName;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO
    {
        public DISPLAYCONFIG_DEVICE_INFO_HEADER Header;
        public uint Value;
        public uint ColorEncoding;
        public uint BitsPerColorChannel;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DISPLAYCONFIG_SDR_WHITE_LEVEL
    {
        public DISPLAYCONFIG_DEVICE_INFO_HEADER Header;
        public uint SDRWhiteLevel;
    }

    [DllImport("user32.dll")]
    private static extern int GetDisplayConfigBufferSizes(uint flags, out uint numPaths, out uint numModes);

    [DllImport("user32.dll")]
    private static extern int QueryDisplayConfig(uint flags, ref uint numPaths, [In, Out] DISPLAYCONFIG_PATH_INFO[] paths, ref uint numModes, [In, Out] DISPLAYCONFIG_MODE_INFO[] modes, IntPtr currentTopology);

    [DllImport("user32.dll", EntryPoint = "DisplayConfigGetDeviceInfo")]
    private static extern int DisplayConfigGetSourceName(ref DISPLAYCONFIG_SOURCE_DEVICE_NAME request);

    [DllImport("user32.dll", EntryPoint = "DisplayConfigGetDeviceInfo")]
    private static extern int DisplayConfigGetColorInfo(ref DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO request);

    [DllImport("user32.dll", EntryPoint = "DisplayConfigGetDeviceInfo")]
    private static extern int DisplayConfigGetSdrWhiteLevel(ref DISPLAYCONFIG_SDR_WHITE_LEVEL request);

    public static IntPtr MonitorForRegion(int left, int top, int width, int height)
    {
        RECT r;
        r.Left = left; r.Top = top; r.Right = left + width; r.Bottom = top + height;
        return MonitorFromRect(ref r, 2);
    }

    private static bool FindDisplayPath(IntPtr hmon, out DISPLAYCONFIG_PATH_INFO found)
    {
        found = new DISPLAYCONFIG_PATH_INFO();
        MONITORINFOEX info = new MONITORINFOEX();
        info.Size = Marshal.SizeOf(typeof(MONITORINFOEX));
        if (!GetMonitorInfoW(hmon, ref info)) { return false; }
        uint numPaths;
        uint numModes;
        if (GetDisplayConfigBufferSizes(2, out numPaths, out numModes) != 0) { return false; }
        DISPLAYCONFIG_PATH_INFO[] paths = new DISPLAYCONFIG_PATH_INFO[numPaths];
        DISPLAYCONFIG_MODE_INFO[] modes = new DISPLAYCONFIG_MODE_INFO[numModes];
        if (QueryDisplayConfig(2, ref numPaths, paths, ref numModes, modes, IntPtr.Zero) != 0) { return false; }
        for (int i = 0; i < numPaths; i++)
        {
            DISPLAYCONFIG_SOURCE_DEVICE_NAME sourceName = new DISPLAYCONFIG_SOURCE_DEVICE_NAME();
            sourceName.Header.Type = 1;
            sourceName.Header.Size = (uint)Marshal.SizeOf(typeof(DISPLAYCONFIG_SOURCE_DEVICE_NAME));
            sourceName.Header.AdapterId = paths[i].Source.AdapterId;
            sourceName.Header.Id = paths[i].Source.Id;
            if (DisplayConfigGetSourceName(ref sourceName) != 0) { continue; }
            if (!string.Equals(sourceName.ViewGdiDeviceName, info.Device, StringComparison.OrdinalIgnoreCase)) { continue; }
            found = paths[i];
            return true;
        }
        return false;
    }

    // True when Windows "advanced color" (HDR) is active on the monitor -
    // the case where GDI captures come back washed-out (issue #33).
    public static bool IsHdrEnabled(IntPtr hmon)
    {
        try
        {
            DISPLAYCONFIG_PATH_INFO path;
            if (!FindDisplayPath(hmon, out path)) { return false; }
            DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO color = new DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO();
            color.Header.Type = 9;
            color.Header.Size = (uint)Marshal.SizeOf(typeof(DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO));
            color.Header.AdapterId = path.Target.AdapterId;
            color.Header.Id = path.Target.Id;
            if (DisplayConfigGetColorInfo(ref color) != 0) { return false; }
            return (color.Value & 2) != 0;
        }
        catch { return false; }
    }

    // The monitor's SDR white level in scRGB units (1.0 = 80 nits). SDR
    // content on an HDR desktop renders at this brightness; dividing by it
    // during tone mapping puts SDR white back at exactly 255.
    public static double SdrWhiteScale(IntPtr hmon)
    {
        try
        {
            DISPLAYCONFIG_PATH_INFO path;
            if (!FindDisplayPath(hmon, out path)) { return 1.0; }
            DISPLAYCONFIG_SDR_WHITE_LEVEL white = new DISPLAYCONFIG_SDR_WHITE_LEVEL();
            white.Header.Type = 11;
            white.Header.Size = (uint)Marshal.SizeOf(typeof(DISPLAYCONFIG_SDR_WHITE_LEVEL));
            white.Header.AdapterId = path.Target.AdapterId;
            white.Header.Id = path.Target.Id;
            if (DisplayConfigGetSdrWhiteLevel(ref white) != 0) { return 1.0; }
            if (white.SDRWhiteLevel < 1000) { return 1.0; }
            return white.SDRWhiteLevel / 1000.0;
        }
        catch { return 1.0; }
    }

    internal static float HalfToFloat(ushort half)
    {
        int sign = (half >> 15) & 1;
        int exponent = (half >> 10) & 0x1F;
        int mantissa = half & 0x3FF;
        float value;
        if (exponent == 0)
        {
            value = (float)(mantissa * Math.Pow(2, -24));
        }
        else if (exponent == 31)
        {
            value = mantissa == 0 ? float.PositiveInfinity : float.NaN;
        }
        else
        {
            value = (float)((1.0 + mantissa / 1024.0) * Math.Pow(2, exponent - 15));
        }
        return sign == 1 ? -value : value;
    }

    internal static byte LinearToSrgbByte(double v)
    {
        if (double.IsNaN(v) || v <= 0.0) { return 0; }
        if (v >= 1.0) { return 255; }
        double s = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.Pow(v, 1.0 / 2.4) - 0.055;
        int b = (int)Math.Round(s * 255.0);
        if (b < 0) { b = 0; }
        if (b > 255) { b = 255; }
        return (byte)b;
    }

    private static void CheckHr(int hr, string what)
    {
        if (hr < 0) { throw new Exception(what + " failed: 0x" + hr.ToString("X8")); }
    }

    private static void SafeClose(IntPtr winrtObject)
    {
        if (winrtObject == IntPtr.Zero) { return; }
        try
        {
            Guid closableIid = new Guid("30D5A829-7FA4-4026-83BB-D75BAE4EA99E");
            IntPtr closable;
            if (Marshal.QueryInterface(winrtObject, ref closableIid, out closable) == 0)
            {
                FnThisOnly close = (FnThisOnly)VtableFn(closable, 6, typeof(FnThisOnly));
                close(closable);
                Marshal.Release(closable);
            }
        }
        catch { }
    }

    // Capture a screen region through Windows.Graphics.Capture. On HDR
    // monitors the frame is read as float16 scRGB and tone-mapped against
    // the SDR white level, which is exactly what GDI's CopyFromScreen fails
    // to do (issue #33). Returns a PNG in memory; no desktop image is written to a temporary file.
    public static byte[] CaptureRegion(int left, int top, int width, int height, bool forceHdrPath)
    {
        if (width <= 0 || height <= 0 || width > 8192 || height > 8192 || (long)width * height > 16777216)
            throw new ArgumentOutOfRangeException("width", "Invalid capture dimensions.");
        IntPtr hmon = MonitorForRegion(left, top, width, height);
        MONITORINFOEX monInfo = new MONITORINFOEX();
        monInfo.Size = Marshal.SizeOf(typeof(MONITORINFOEX));
        if (!GetMonitorInfoW(hmon, ref monInfo)) { throw new Exception("GetMonitorInfo failed"); }
        int cropX = left - monInfo.Monitor.Left;
        int cropY = top - monInfo.Monitor.Top;
        bool hdr = forceHdrPath || IsHdrEnabled(hmon);
        int pixelFormat = hdr ? 10 : 87; // R16G16B16A16Float : B8G8R8A8UIntNormalized
        int bytesPerPixel = hdr ? 8 : 4;

        IntPtr device = IntPtr.Zero;
        IntPtr context = IntPtr.Zero;
        IntPtr dxgi = IntPtr.Zero;
        IntPtr inspectableDevice = IntPtr.Zero;
        IntPtr itemPtr = IntPtr.Zero;
        IntPtr poolPtr = IntPtr.Zero;
        IntPtr sessionPtr = IntPtr.Zero;
        IntPtr framePtr = IntPtr.Zero;
        IntPtr surfacePtr = IntPtr.Zero;
        IntPtr accessPtr = IntPtr.Zero;
        IntPtr texturePtr = IntPtr.Zero;
        IntPtr stagingPtr = IntPtr.Zero;
        IntPtr classId = IntPtr.Zero;
        try
        {
            int featureLevel;
            int hr = D3D11CreateDevice(IntPtr.Zero, 1, IntPtr.Zero, 0x20, IntPtr.Zero, 0, 7, out device, out featureLevel, out context);
            if (hr < 0)
            {
                hr = D3D11CreateDevice(IntPtr.Zero, 5, IntPtr.Zero, 0x20, IntPtr.Zero, 0, 7, out device, out featureLevel, out context);
            }
            CheckHr(hr, "D3D11CreateDevice");
            Guid dxgiIid = new Guid("54ec77fa-1377-44e6-8c32-88fd5f44c84c");
            CheckHr(Marshal.QueryInterface(device, ref dxgiIid, out dxgi), "QI IDXGIDevice");
            CheckHr(CreateDirect3D11DeviceFromDXGIDevice(dxgi, out inspectableDevice), "CreateDirect3D11DeviceFromDXGIDevice");

            string className = "Windows.Graphics.Capture.GraphicsCaptureItem";
            CheckHr(WindowsCreateString(className, className.Length, out classId), "WindowsCreateString");
            Guid interopIid = new Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356");
            IntPtr factoryPtr;
            CheckHr(RoGetActivationFactory(classId, ref interopIid, out factoryPtr), "RoGetActivationFactory(item)");
            IGraphicsCaptureItemInterop interop = (IGraphicsCaptureItemInterop)Marshal.GetObjectForIUnknown(factoryPtr);
            Marshal.Release(factoryPtr);
            Guid itemIid = new Guid("79C3F95B-31F7-4EC2-A464-632EF5D30760");
            itemPtr = interop.CreateForMonitor(hmon, ref itemIid);
            Marshal.ReleaseComObject(interop);
            SizeInt32 itemSize;
            FnOutSize getSize = (FnOutSize)VtableFn(itemPtr, 7, typeof(FnOutSize));
            CheckHr(getSize(itemPtr, out itemSize), "GraphicsCaptureItem.Size");
            WindowsDeleteString(classId);
            classId = IntPtr.Zero;

            string poolClass = "Windows.Graphics.Capture.Direct3D11CaptureFramePool";
            CheckHr(WindowsCreateString(poolClass, poolClass.Length, out classId), "WindowsCreateString(pool)");
            Guid statics2Iid = new Guid("589B103F-6BBC-5DF5-A991-02E28B3B66D5");
            IntPtr statics2Ptr;
            CheckHr(RoGetActivationFactory(classId, ref statics2Iid, out statics2Ptr), "RoGetActivationFactory(framePool statics2)");
            FnCreateFreeThreaded createFreeThreaded = (FnCreateFreeThreaded)VtableFn(statics2Ptr, 6, typeof(FnCreateFreeThreaded));
            int poolHr = createFreeThreaded(statics2Ptr, inspectableDevice, pixelFormat, 2, itemSize, out poolPtr);
            Marshal.Release(statics2Ptr);
            CheckHr(poolHr, "Direct3D11CaptureFramePool.CreateFreeThreaded");

            FnPtrOutPtr createSession = (FnPtrOutPtr)VtableFn(poolPtr, 10, typeof(FnPtrOutPtr));
            CheckHr(createSession(poolPtr, itemPtr, out sessionPtr), "CreateCaptureSession");

            try
            {
                Guid session2Iid = new Guid("2C39AE40-7D2E-5044-804E-8B6799D4CF9E");
                IntPtr session2Ptr;
                if (Marshal.QueryInterface(sessionPtr, ref session2Iid, out session2Ptr) == 0)
                {
                    FnPutByte putCursor = (FnPutByte)VtableFn(session2Ptr, 7, typeof(FnPutByte));
                    putCursor(session2Ptr, 0);
                    Marshal.Release(session2Ptr);
                }
            }
            catch { }
            try
            {
                Guid session3Iid = new Guid("F2CDD966-22AE-5EA1-9596-3A289344C3BE");
                IntPtr session3Ptr;
                if (Marshal.QueryInterface(sessionPtr, ref session3Iid, out session3Ptr) == 0)
                {
                    FnPutByte putBorder = (FnPutByte)VtableFn(session3Ptr, 7, typeof(FnPutByte));
                    putBorder(session3Ptr, 0);
                    Marshal.Release(session3Ptr);
                }
            }
            catch { }

            FnThisOnly startCapture = (FnThisOnly)VtableFn(sessionPtr, 6, typeof(FnThisOnly));
            CheckHr(startCapture(sessionPtr), "StartCapture");

            FnOutPtr tryGetNextFrame = (FnOutPtr)VtableFn(poolPtr, 7, typeof(FnOutPtr));
            DateTime deadline = DateTime.UtcNow.AddSeconds(5);
            while (framePtr == IntPtr.Zero && DateTime.UtcNow < deadline)
            {
                CheckHr(tryGetNextFrame(poolPtr, out framePtr), "TryGetNextFrame");
                if (framePtr == IntPtr.Zero) { System.Threading.Thread.Sleep(15); }
            }
            if (framePtr == IntPtr.Zero) { throw new Exception("Windows.Graphics.Capture produced no frame within 5 seconds."); }

            FnOutPtr getSurface = (FnOutPtr)VtableFn(framePtr, 6, typeof(FnOutPtr));
            CheckHr(getSurface(framePtr, out surfacePtr), "Direct3D11CaptureFrame.Surface");

            Guid accessIid = new Guid("A9B3D012-3DF2-4EE3-B8D1-8695F457D3C1");
            CheckHr(Marshal.QueryInterface(surfacePtr, ref accessIid, out accessPtr), "QI IDirect3DDxgiInterfaceAccess");
            FnGetInterface getInterface = (FnGetInterface)VtableFn(accessPtr, 3, typeof(FnGetInterface));
            Guid textureIid = new Guid("6F15AAF2-D208-4E89-9AB4-489535D34F9C");
            CheckHr(getInterface(accessPtr, ref textureIid, out texturePtr), "IDirect3DDxgiInterfaceAccess.GetInterface");

            if (cropX < 0 || cropY < 0 || (long)cropX + width > itemSize.Width || (long)cropY + height > itemSize.Height)
                throw new Exception("Keep the complete capture region on one monitor.");
            int cropW = width;
            int cropH = height;

            D3D11_TEXTURE2D_DESC desc = new D3D11_TEXTURE2D_DESC();
            desc.Width = (uint)cropW;
            desc.Height = (uint)cropH;
            desc.MipLevels = 1;
            desc.ArraySize = 1;
            desc.Format = pixelFormat;
            desc.SampleCount = 1;
            desc.SampleQuality = 0;
            desc.Usage = 3;           // D3D11_USAGE_STAGING
            desc.BindFlags = 0;
            desc.CPUAccessFlags = 0x20000; // D3D11_CPU_ACCESS_READ
            desc.MiscFlags = 0;
            ID3D11DeviceAbi deviceAbi = (ID3D11DeviceAbi)Marshal.GetObjectForIUnknown(device);
            CheckHr(deviceAbi.CreateTexture2D(ref desc, IntPtr.Zero, out stagingPtr), "CreateTexture2D(staging)");
            Marshal.ReleaseComObject(deviceAbi);

            D3D11_BOX box = new D3D11_BOX();
            box.Left = (uint)cropX;
            box.Top = (uint)cropY;
            box.Front = 0;
            box.Right = (uint)(cropX + cropW);
            box.Bottom = (uint)(cropY + cropH);
            box.Back = 1;
            ID3D11DeviceContextAbi contextAbi = (ID3D11DeviceContextAbi)Marshal.GetObjectForIUnknown(context);
            contextAbi.CopySubresourceRegion(stagingPtr, 0, 0, 0, 0, texturePtr, 0, ref box);
            D3D11_MAPPED_SUBRESOURCE mapped;
            CheckHr(contextAbi.Map(stagingPtr, 0, 1, 0, out mapped), "Map(staging)");
            try
            {
                byte[] rowBytes = new byte[cropW * bytesPerPixel];
                byte[] bgra = new byte[cropW * cropH * 4];
                double invWhite = 1.0 / SdrWhiteScale(hmon);
                for (int y = 0; y < cropH; y++)
                {
                    Marshal.Copy(new IntPtr(mapped.Data.ToInt64() + (long)y * mapped.RowPitch), rowBytes, 0, rowBytes.Length);
                    int destBase = y * cropW * 4;
                    if (hdr)
                    {
                        for (int x = 0; x < cropW; x++)
                        {
                            int src = x * 8;
                            double r = HalfToFloat(BitConverter.ToUInt16(rowBytes, src)) * invWhite;
                            double g = HalfToFloat(BitConverter.ToUInt16(rowBytes, src + 2)) * invWhite;
                            double b = HalfToFloat(BitConverter.ToUInt16(rowBytes, src + 4)) * invWhite;
                            bgra[destBase + x * 4] = LinearToSrgbByte(b);
                            bgra[destBase + x * 4 + 1] = LinearToSrgbByte(g);
                            bgra[destBase + x * 4 + 2] = LinearToSrgbByte(r);
                            bgra[destBase + x * 4 + 3] = 255;
                        }
                    }
                    else
                    {
                        Array.Copy(rowBytes, 0, bgra, destBase, cropW * 4);
                    }
                }
                using (Bitmap bmp = new Bitmap(cropW, cropH, PixelFormat.Format32bppRgb))
                {
                    Rectangle rect = new Rectangle(0, 0, cropW, cropH);
                    BitmapData bits = bmp.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppRgb);
                    int destStride = Math.Abs(bits.Stride);
                    for (int y = 0; y < cropH; y++)
                    {
                        Marshal.Copy(bgra, y * cropW * 4, new IntPtr(bits.Scan0.ToInt64() + (long)y * destStride), cropW * 4);
                    }
                    bmp.UnlockBits(bits);
                    using (var output = new System.IO.MemoryStream())
                    {
                        bmp.Save(output, ImageFormat.Png);
                        return output.ToArray();
                    }
                }
            }
            finally
            {
                contextAbi.Unmap(stagingPtr, 0);
                Marshal.ReleaseComObject(contextAbi);
            }
        }
        finally
        {
            SafeClose(sessionPtr);
            SafeClose(framePtr);
            SafeClose(poolPtr);
            if (classId != IntPtr.Zero) { WindowsDeleteString(classId); }
            if (stagingPtr != IntPtr.Zero) { Marshal.Release(stagingPtr); }
            if (texturePtr != IntPtr.Zero) { Marshal.Release(texturePtr); }
            if (accessPtr != IntPtr.Zero) { Marshal.Release(accessPtr); }
            if (surfacePtr != IntPtr.Zero) { Marshal.Release(surfacePtr); }
            if (framePtr != IntPtr.Zero) { Marshal.Release(framePtr); }
            if (sessionPtr != IntPtr.Zero) { Marshal.Release(sessionPtr); }
            if (poolPtr != IntPtr.Zero) { Marshal.Release(poolPtr); }
            if (itemPtr != IntPtr.Zero) { Marshal.Release(itemPtr); }
            if (inspectableDevice != IntPtr.Zero) { Marshal.Release(inspectableDevice); }
            if (dxgi != IntPtr.Zero) { Marshal.Release(dxgi); }
            if (context != IntPtr.Zero) { Marshal.Release(context); }
            if (device != IntPtr.Zero) { Marshal.Release(device); }
        }
    }
}
