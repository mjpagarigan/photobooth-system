# Grace Booth Nikon USB tether helper.
# Long-lived child process. Reads one JSON request per line on stdin and writes one JSON
# response per line on stdout: { id, ok, data } or { id, ok: false, code, message }.
# Talks to Nikon DSLRs (e.g. D5200 over 8-pin USB) via Windows' built-in WPD/MTP driver
# (WUDFWpdMtp) with zero third-party software or custom USB drivers.

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$csharpSource = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace GraceBoothNikon
{
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    public struct PROPERTYKEY
    {
        public Guid fmtid;
        public uint pid;
        public PROPERTYKEY(string guid, uint pid)
        {
            this.fmtid = new Guid(guid);
            this.pid = pid;
        }
    }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    public struct PROPVARIANT
    {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(2)] public ushort wReserved1;
        [FieldOffset(4)] public ushort wReserved2;
        [FieldOffset(6)] public ushort wReserved3;
        [FieldOffset(8)] public uint ulVal;
        [FieldOffset(8)] public int lVal;
        [FieldOffset(8)] public IntPtr ptrVal;
    }

    [ComImport, Guid("6848f6f2-3155-4f86-b6f5-263eeeab3143"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPortableDeviceValues
    {
        void GetCount([In] ref uint pcelt);
        void GetAt([In] uint index, [Out] out PROPERTYKEY pKey, [Out] out PROPVARIANT pValue);
        void SetValue([In] ref PROPERTYKEY key, [In] ref PROPVARIANT pValue);
        void GetValue([In] ref PROPERTYKEY key, [Out] out PROPVARIANT pValue);
        void SetStringValue([In] ref PROPERTYKEY key, [In, MarshalAs(UnmanagedType.LPWStr)] string Value);
        void GetStringValue([In] ref PROPERTYKEY key, [Out, MarshalAs(UnmanagedType.LPWStr)] out string pValue);
        void SetUnsignedIntegerValue([In] ref PROPERTYKEY key, [In] uint Value);
        void GetUnsignedIntegerValue([In] ref PROPERTYKEY key, [Out] out uint pValue);
        void SetSignedIntegerValue([In] ref PROPERTYKEY key, [In] int Value);
        void GetSignedIntegerValue([In] ref PROPERTYKEY key, [Out] out int pValue);
        void SetUnsignedLargeIntegerValue([In] ref PROPERTYKEY key, [In] ulong Value);
        void GetUnsignedLargeIntegerValue([In] ref PROPERTYKEY key, [Out] out ulong pValue);
        void SetSignedLargeIntegerValue([In] ref PROPERTYKEY key, [In] long Value);
        void GetSignedLargeIntegerValue([In] ref PROPERTYKEY key, [Out] out long pValue);
        void SetFloatValue([In] ref PROPERTYKEY key, [In] float Value);
        void GetFloatValue([In] ref PROPERTYKEY key, [Out] out float pValue);
        void SetErrorValue([In] ref PROPERTYKEY key, [In, MarshalAs(UnmanagedType.Error)] int Value);
        void GetErrorValue([In] ref PROPERTYKEY key, [Out, MarshalAs(UnmanagedType.Error)] out int pValue);
        void SetKeyValue([In] ref PROPERTYKEY key, [In] ref PROPERTYKEY Value);
        void GetKeyValue([In] ref PROPERTYKEY key, [Out] out PROPERTYKEY pValue);
        void SetBoolValue([In] ref PROPERTYKEY key, [In] int Value);
        void GetBoolValue([In] ref PROPERTYKEY key, [Out] out int pValue);
        void SetIUnknownValue([In] ref PROPERTYKEY key, [In, MarshalAs(UnmanagedType.IUnknown)] object pValue);
        void GetIUnknownValue([In] ref PROPERTYKEY key, [Out, MarshalAs(UnmanagedType.IUnknown)] out object ppValue);
        void SetGuidValue([In] ref PROPERTYKEY key, [In] ref Guid Value);
        void GetGuidValue([In] ref PROPERTYKEY key, [Out] out Guid pValue);
        void SetBufferValue([In] ref PROPERTYKEY key, [In, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 2)] byte[] pValue, [In] uint cbValue);
        void GetBufferValue([In] ref PROPERTYKEY key, [Out] out IntPtr ppValue, [Out] out uint pcbValue);
        void SetIPortableDeviceValuesValue([In] ref PROPERTYKEY key, [In] IPortableDeviceValues pValue);
        void GetIPortableDeviceValuesValue([In] ref PROPERTYKEY key, [Out] out IPortableDeviceValues ppValue);
        void SetIPortableDevicePropVariantCollectionValue([In] ref PROPERTYKEY key, [In] IPortableDevicePropVariantCollection pValue);
        void GetIPortableDevicePropVariantCollectionValue([In] ref PROPERTYKEY key, [Out] out IPortableDevicePropVariantCollection ppValue);
        void SetIPortableDeviceKeyCollectionValue([In] ref PROPERTYKEY key, [In] IntPtr pValue);
        void GetIPortableDeviceKeyCollectionValue([In] ref PROPERTYKEY key, [Out] out IntPtr ppValue);
        void SetIPortableDeviceValuesCollectionValue([In] ref PROPERTYKEY key, [In] IntPtr pValue);
        void GetIPortableDeviceValuesCollectionValue([In] ref PROPERTYKEY key, [Out] out IntPtr ppValue);
        void RemoveValue([In] ref PROPERTYKEY key);
        void CopyValuesFromPropertyStore([In] IntPtr pStore);
        void CopyValuesToPropertyStore([In] IntPtr pStore);
        void Clear();
    }

    [ComImport, Guid("89b2e422-4f1b-4316-bcef-a44afea83eb3"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPortableDevicePropVariantCollection
    {
        void GetCount([In] ref uint pcElems);
        void GetAt([In] uint dwIndex, [Out] out PROPVARIANT pValue);
        void Add([In] ref PROPVARIANT pValue);
        void GetType([Out] out ushort pvt);
        void ChangeType([In] ushort vt);
        void Clear();
        void RemoveAt([In] uint dwIndex);
    }

    [ComImport, Guid("a1567595-4c2f-4574-a6fa-ecef917b9a40"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPortableDeviceManager
    {
        void GetDevices([In, Out, MarshalAs(UnmanagedType.LPArray, ArraySubType = UnmanagedType.LPWStr)] string[] pPnPDeviceIDs, [In, Out] ref uint pcPnPDeviceIDs);
        void RefreshDeviceList();
        void GetDeviceFriendlyName([In, MarshalAs(UnmanagedType.LPWStr)] string pszPnPDeviceID, [In, Out, MarshalAs(UnmanagedType.LPArray)] char[] pDeviceFriendlyName, [In, Out] ref uint pcchDeviceFriendlyName);
        void GetDeviceDescription([In, MarshalAs(UnmanagedType.LPWStr)] string pszPnPDeviceID, [In, Out, MarshalAs(UnmanagedType.LPArray)] char[] pDeviceDescription, [In, Out] ref uint pcchDeviceDescription);
        void GetDeviceManufacturer([In, MarshalAs(UnmanagedType.LPWStr)] string pszPnPDeviceID, [In, Out, MarshalAs(UnmanagedType.LPArray)] char[] pDeviceManufacturer, [In, Out] ref uint pcchDeviceManufacturer);
        void GetDeviceProperty([In, MarshalAs(UnmanagedType.LPWStr)] string pszPnPDeviceID, [In, MarshalAs(UnmanagedType.LPWStr)] string pszDevicePropertyName, [In, Out] byte[] pData, [In, Out] ref uint pcbData, [In, Out] ref uint pdwType);
        void GetPrivateDevices([In, Out, MarshalAs(UnmanagedType.LPArray, ArraySubType = UnmanagedType.LPWStr)] string[] pPnPDeviceIDs, [In, Out] ref uint pcPnPDeviceIDs);
    }

    [ComImport, Guid("625e2df8-6392-4cf0-9ad1-3cfa5f17775c"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPortableDevice
    {
        void Open([In, MarshalAs(UnmanagedType.LPWStr)] string pszPnPDeviceID, [In] IPortableDeviceValues pClientInfo);
        void SendCommand([In] uint dwFlags, [In] IPortableDeviceValues pParameters, [Out] out IPortableDeviceValues ppResults);
        void Content([Out] out IntPtr ppContent);
        void Capabilities([Out] out IntPtr ppCapabilities);
        void Cancel();
        void Close();
        void Advise([In] uint dwFlags, [In] IntPtr pCallback, [In] IPortableDeviceValues pParameters, [Out, MarshalAs(UnmanagedType.LPWStr)] out string ppszCookie);
        void Unadvise([In, MarshalAs(UnmanagedType.LPWStr)] string pszCookie);
        void GetPnPDeviceID([Out, MarshalAs(UnmanagedType.LPWStr)] out string ppszPnPDeviceID);
    }

    public class NikonStatusResult
    {
        public bool Connected;
        public string Model;
        public int BatteryPercent;
        public string ImageSize;
        public string Message;
    }

    public class NikonCaptureResult
    {
        public string Path;
        public int Bytes;
        public long ElapsedMs;
        public string Model;
    }

    public class NikonLiveViewFrameResult
    {
        public bool Skipped;
        public string JpegBase64;
        public int Width;
        public int Height;
    }

    public class NikonProtocolException : Exception
    {
        public string Code { get; private set; }
        public NikonProtocolException(string code, string message) : base(message)
        {
            this.Code = code;
        }
    }

    public sealed class NikonClient
    {
        private static readonly Guid CLSID_PortableDeviceManager = new Guid("0af10cec-2ecd-4b92-9581-34f6ae0637f3");
        private static readonly Guid CLSID_PortableDeviceFTM = new Guid("f7c0039a-4762-488a-b4b3-760ef9a1ba9b");
        private static readonly Guid CLSID_PortableDeviceValues = new Guid("0c15d503-d017-47ce-9016-7b3f978721cc");
        private static readonly Guid CLSID_PortableDevicePropVariantCollection = new Guid("08a99e2f-6d6d-4b80-af5a-baf2bcbe4cb9");

        private static PROPERTYKEY WPD_PROPERTY_COMMON_COMMAND_CATEGORY = new PROPERTYKEY("f0422a9c-5dc8-4440-b5bd-5df28835658a", 1001);
        private static PROPERTYKEY WPD_PROPERTY_COMMON_COMMAND_ID = new PROPERTYKEY("f0422a9c-5dc8-4440-b5bd-5df28835658a", 1002);
        private static PROPERTYKEY WPD_PROPERTY_COMMON_HRESULT = new PROPERTYKEY("f0422a9c-5dc8-4440-b5bd-5df28835658a", 1003);

        private static readonly Guid WPD_CATEGORY_MTP_EXT_VENDOR_OPERATIONS = new Guid("4d545058-1a2e-4106-a357-771e0819fc56");
        private static PROPERTYKEY WPD_COMMAND_MTP_EXT_EXECUTE_COMMAND_WITHOUT_DATA_PHASE = new PROPERTYKEY("4d545058-1a2e-4106-a357-771e0819fc56", 12);
        private static PROPERTYKEY WPD_COMMAND_MTP_EXT_EXECUTE_COMMAND_WITH_DATA_TO_READ = new PROPERTYKEY("4d545058-1a2e-4106-a357-771e0819fc56", 13);
        private static PROPERTYKEY WPD_COMMAND_MTP_EXT_READ_DATA = new PROPERTYKEY("4d545058-1a2e-4106-a357-771e0819fc56", 15);
        private static PROPERTYKEY WPD_COMMAND_MTP_EXT_END_DATA_TRANSFER = new PROPERTYKEY("4d545058-1a2e-4106-a357-771e0819fc56", 17);

        private static PROPERTYKEY WPD_PROPERTY_MTP_EXT_OPERATION_CODE = new PROPERTYKEY("4d545058-1a2e-4106-a357-771e0819fc56", 1001);
        private static PROPERTYKEY WPD_PROPERTY_MTP_EXT_OPERATION_PARAMS = new PROPERTYKEY("4d545058-1a2e-4106-a357-771e0819fc56", 1002);
        private static PROPERTYKEY WPD_PROPERTY_MTP_EXT_RESPONSE_CODE = new PROPERTYKEY("4d545058-1a2e-4106-a357-771e0819fc56", 1003);
        private static PROPERTYKEY WPD_PROPERTY_MTP_EXT_TRANSFER_CONTEXT = new PROPERTYKEY("4d545058-1a2e-4106-a357-771e0819fc56", 1006);
        private static PROPERTYKEY WPD_PROPERTY_MTP_EXT_TRANSFER_TOTAL_DATA_SIZE = new PROPERTYKEY("4d545058-1a2e-4106-a357-771e0819fc56", 1007);
        private static PROPERTYKEY WPD_PROPERTY_MTP_EXT_TRANSFER_NUM_BYTES_TO_READ = new PROPERTYKEY("4d545058-1a2e-4106-a357-771e0819fc56", 1008);
        private static PROPERTYKEY WPD_PROPERTY_MTP_EXT_TRANSFER_NUM_BYTES_READ = new PROPERTYKEY("4d545058-1a2e-4106-a357-771e0819fc56", 1009);
        private static PROPERTYKEY WPD_PROPERTY_MTP_EXT_TRANSFER_DATA = new PROPERTYKEY("4d545058-1a2e-4106-a357-771e0819fc56", 1012);
        private static PROPERTYKEY WPD_PROPERTY_MTP_EXT_OPTIMAL_TRANSFER_BUFFER_SIZE = new PROPERTYKEY("4d545058-1a2e-4106-a357-771e0819fc56", 1013);

        private static PROPERTYKEY WPD_CLIENT_NAME = new PROPERTYKEY("204d9f0c-2292-4080-9f42-40664e70f859", 2);
        private static PROPERTYKEY WPD_CLIENT_MAJOR_VERSION = new PROPERTYKEY("204d9f0c-2292-4080-9f42-40664e70f859", 3);
        private static PROPERTYKEY WPD_CLIENT_MINOR_VERSION = new PROPERTYKEY("204d9f0c-2292-4080-9f42-40664e70f859", 4);
        private static PROPERTYKEY WPD_CLIENT_REVISION = new PROPERTYKEY("204d9f0c-2292-4080-9f42-40664e70f859", 5);

        private const uint PTP_RC_OK = 0x2001;
        private const uint PTP_RC_OPERATION_NOT_SUPPORTED = 0x2005;
        private const uint PTP_RC_DEVICE_BUSY = 0x2019;

        private const uint PTP_OC_GET_OBJECT_INFO = 0x1008;
        private const uint PTP_OC_GET_OBJECT = 0x1009;
        private const uint PTP_OC_GET_DEVICE_PROP_VALUE = 0x1015;
        private const uint PTP_OC_NIKON_INITIATE_CAPTURE_SDRAM = 0x90C0;
        private const uint PTP_OC_NIKON_GET_EVENT = 0x90C7;
        private const uint PTP_OC_NIKON_DEVICE_READY = 0x90C8;
        private const uint PTP_OC_NIKON_START_LIVE_VIEW = 0x9201;
        private const uint PTP_OC_NIKON_END_LIVE_VIEW = 0x9202;
        private const uint PTP_OC_NIKON_GET_LIVE_VIEW_IMG = 0x9203;
        private const uint PTP_OC_NIKON_INITIATE_CAPTURE_MEDIA = 0x9207;

        private const ushort PTP_EC_OBJECT_ADDED = 0x4002;
        private const ushort PTP_EC_NIKON_OBJECT_ADDED_IN_SDRAM = 0xC101;

        private IPortableDevice device;
        private string deviceId;
        private string deviceModel;
        private bool liveViewActive;

        private static IPortableDeviceValues NewValues()
        {
            return (IPortableDeviceValues)Activator.CreateInstance(Type.GetTypeFromCLSID(CLSID_PortableDeviceValues));
        }

        private static IPortableDevicePropVariantCollection NewCollection()
        {
            return (IPortableDevicePropVariantCollection)Activator.CreateInstance(Type.GetTypeFromCLSID(CLSID_PortableDevicePropVariantCollection));
        }

        public void Disconnect()
        {
            if (this.device != null)
            {
                if (this.liveViewActive)
                {
                    try { ExecuteNoData(PTP_OC_NIKON_END_LIVE_VIEW); } catch { }
                }
                try { this.device.Close(); } catch { }
                try { Marshal.ReleaseComObject(this.device); } catch { }
                this.device = null;
            }
            this.liveViewActive = false;
            this.deviceId = null;
            this.deviceModel = null;
        }

        private bool FindNikonDevice(out string foundId, out string foundName)
        {
            foundId = null;
            foundName = null;
            var mgr = (IPortableDeviceManager)Activator.CreateInstance(Type.GetTypeFromCLSID(CLSID_PortableDeviceManager));
            try
            {
                mgr.RefreshDeviceList();
                uint count = 0;
                mgr.GetDevices(null, ref count);
                if (count == 0) return false;
                var ids = new string[count];
                mgr.GetDevices(ids, ref count);
                foreach (var id in ids)
                {
                    if (string.IsNullOrEmpty(id)) continue;
                    string name = ReadFriendlyName(mgr, id);
                    string mfg = ReadManufacturer(mgr, id);
                    if (id.IndexOf("vid_04b0", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        mfg.IndexOf("Nikon", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        foundId = id;
                        foundName = string.IsNullOrEmpty(name) ? "Nikon DSLR" : name;
                        return true;
                    }
                }
                return false;
            }
            finally
            {
                try { Marshal.ReleaseComObject(mgr); } catch { }
            }
        }

        private static string ReadFriendlyName(IPortableDeviceManager mgr, string id)
        {
            try
            {
                uint len = 0;
                mgr.GetDeviceFriendlyName(id, null, ref len);
                if (len == 0) return "";
                var chars = new char[len];
                mgr.GetDeviceFriendlyName(id, chars, ref len);
                return new string(chars).TrimEnd('\0');
            }
            catch { return ""; }
        }

        private static string ReadManufacturer(IPortableDeviceManager mgr, string id)
        {
            try
            {
                uint len = 0;
                mgr.GetDeviceManufacturer(id, null, ref len);
                if (len == 0) return "";
                var chars = new char[len];
                mgr.GetDeviceManufacturer(id, chars, ref len);
                return new string(chars).TrimEnd('\0');
            }
            catch { return ""; }
        }

        private void EnsureConnected()
        {
            if (this.device != null)
            {
                try
                {
                    uint rc = ExecuteNoData(PTP_OC_NIKON_DEVICE_READY);
                    if (rc == PTP_RC_OK || rc == PTP_RC_DEVICE_BUSY) return;
                }
                catch { }
                Disconnect();
            }

            string id;
            string name;
            if (!FindNikonDevice(out id, out name))
            {
                throw new NikonProtocolException("camera_disconnected", "No Nikon camera was found on USB. Check the 8-pin USB cable and camera power.");
            }

            var clientInfo = NewValues();
            clientInfo.SetStringValue(ref WPD_CLIENT_NAME, "GraceBooth");
            clientInfo.SetUnsignedIntegerValue(ref WPD_CLIENT_MAJOR_VERSION, 1);
            clientInfo.SetUnsignedIntegerValue(ref WPD_CLIENT_MINOR_VERSION, 0);
            clientInfo.SetUnsignedIntegerValue(ref WPD_CLIENT_REVISION, 0);

            var dev = (IPortableDevice)Activator.CreateInstance(Type.GetTypeFromCLSID(CLSID_PortableDeviceFTM));
            try
            {
                dev.Open(id, clientInfo);
                this.device = dev;
                this.deviceId = id;
                this.deviceModel = name;
            }
            catch (Exception ex)
            {
                try { Marshal.ReleaseComObject(dev); } catch { }
                throw new NikonProtocolException("camera_open_failed", "Could not open the Nikon USB connection: " + ex.Message);
            }
        }

        private uint ExecuteNoData(uint opcode, params uint[] opParams)
        {
            var p = NewValues();
            var cat = WPD_CATEGORY_MTP_EXT_VENDOR_OPERATIONS;
            p.SetGuidValue(ref WPD_PROPERTY_COMMON_COMMAND_CATEGORY, ref cat);
            p.SetUnsignedIntegerValue(ref WPD_PROPERTY_COMMON_COMMAND_ID, WPD_COMMAND_MTP_EXT_EXECUTE_COMMAND_WITHOUT_DATA_PHASE.pid);
            p.SetUnsignedIntegerValue(ref WPD_PROPERTY_MTP_EXT_OPERATION_CODE, opcode);
            var col = NewCollection();
            foreach (var v in opParams)
            {
                var pv = new PROPVARIANT { vt = 19, ulVal = v };
                col.Add(ref pv);
            }
            p.SetIPortableDevicePropVariantCollectionValue(ref WPD_PROPERTY_MTP_EXT_OPERATION_PARAMS, col);
            IPortableDeviceValues res;
            this.device.SendCommand(0, p, out res);
            int hr;
            res.GetErrorValue(ref WPD_PROPERTY_COMMON_HRESULT, out hr);
            uint resp = 0;
            try { res.GetUnsignedIntegerValue(ref WPD_PROPERTY_MTP_EXT_RESPONSE_CODE, out resp); } catch { }
            if (hr != 0 && resp == 0)
            {
                throw new COMException("WPD command failed for opcode 0x" + opcode.ToString("X4"), hr);
            }
            return resp;
        }

        private byte[] ExecuteReadData(uint opcode, out uint responseCode, params uint[] opParams)
        {
            var p = NewValues();
            var cat = WPD_CATEGORY_MTP_EXT_VENDOR_OPERATIONS;
            p.SetGuidValue(ref WPD_PROPERTY_COMMON_COMMAND_CATEGORY, ref cat);
            p.SetUnsignedIntegerValue(ref WPD_PROPERTY_COMMON_COMMAND_ID, WPD_COMMAND_MTP_EXT_EXECUTE_COMMAND_WITH_DATA_TO_READ.pid);
            p.SetUnsignedIntegerValue(ref WPD_PROPERTY_MTP_EXT_OPERATION_CODE, opcode);
            var col = NewCollection();
            foreach (var v in opParams)
            {
                var pv = new PROPVARIANT { vt = 19, ulVal = v };
                col.Add(ref pv);
            }
            p.SetIPortableDevicePropVariantCollectionValue(ref WPD_PROPERTY_MTP_EXT_OPERATION_PARAMS, col);
            IPortableDeviceValues res;
            this.device.SendCommand(0, p, out res);
            int hr;
            res.GetErrorValue(ref WPD_PROPERTY_COMMON_HRESULT, out hr);
            if (hr != 0)
            {
                responseCode = 0;
                try { res.GetUnsignedIntegerValue(ref WPD_PROPERTY_MTP_EXT_RESPONSE_CODE, out responseCode); } catch { }
                return null;
            }

            string ctx;
            res.GetStringValue(ref WPD_PROPERTY_MTP_EXT_TRANSFER_CONTEXT, out ctx);
            ulong totalSize;
            res.GetUnsignedLargeIntegerValue(ref WPD_PROPERTY_MTP_EXT_TRANSFER_TOTAL_DATA_SIZE, out totalSize);
            uint optBuf = 65536;
            try { res.GetUnsignedIntegerValue(ref WPD_PROPERTY_MTP_EXT_OPTIMAL_TRANSFER_BUFFER_SIZE, out optBuf); } catch { }
            if (optBuf == 0) optBuf = 65536;
            if (totalSize > 50UL * 1024UL * 1024UL)
            {
                throw new NikonProtocolException("capture_size", "The camera photo exceeds the 50 MB safe limit.");
            }

            var output = new byte[totalSize];
            int offset = 0;
            ulong remaining = totalSize;
            while (remaining > 0)
            {
                uint toRead = (uint)Math.Min(remaining, (ulong)optBuf);
                var rp = NewValues();
                rp.SetGuidValue(ref WPD_PROPERTY_COMMON_COMMAND_CATEGORY, ref cat);
                rp.SetUnsignedIntegerValue(ref WPD_PROPERTY_COMMON_COMMAND_ID, WPD_COMMAND_MTP_EXT_READ_DATA.pid);
                rp.SetStringValue(ref WPD_PROPERTY_MTP_EXT_TRANSFER_CONTEXT, ctx);
                rp.SetUnsignedIntegerValue(ref WPD_PROPERTY_MTP_EXT_TRANSFER_NUM_BYTES_TO_READ, toRead);
                rp.SetBufferValue(ref WPD_PROPERTY_MTP_EXT_TRANSFER_DATA, new byte[toRead], toRead);

                IPortableDeviceValues rres;
                this.device.SendCommand(0, rp, out rres);
                uint bytesRead;
                rres.GetUnsignedIntegerValue(ref WPD_PROPERTY_MTP_EXT_TRANSFER_NUM_BYTES_READ, out bytesRead);
                IntPtr bufPtr;
                uint bufLen;
                rres.GetBufferValue(ref WPD_PROPERTY_MTP_EXT_TRANSFER_DATA, out bufPtr, out bufLen);
                try
                {
                    if (bytesRead > 0)
                    {
                        Marshal.Copy(bufPtr, output, offset, (int)bytesRead);
                        offset += (int)bytesRead;
                    }
                }
                finally
                {
                    Marshal.FreeCoTaskMem(bufPtr);
                }
                if (bytesRead == 0) break;
                remaining -= bytesRead;
            }

            var ep = NewValues();
            ep.SetGuidValue(ref WPD_PROPERTY_COMMON_COMMAND_CATEGORY, ref cat);
            ep.SetUnsignedIntegerValue(ref WPD_PROPERTY_COMMON_COMMAND_ID, WPD_COMMAND_MTP_EXT_END_DATA_TRANSFER.pid);
            ep.SetStringValue(ref WPD_PROPERTY_MTP_EXT_TRANSFER_CONTEXT, ctx);
            IPortableDeviceValues eres;
            this.device.SendCommand(0, ep, out eres);
            responseCode = 0;
            try { eres.GetUnsignedIntegerValue(ref WPD_PROPERTY_MTP_EXT_RESPONSE_CODE, out responseCode); } catch { }
            if (offset == output.Length) return output;
            var trimmed = new byte[offset];
            Buffer.BlockCopy(output, 0, trimmed, 0, offset);
            return trimmed;
        }

        private string ReadPtpStringProp(uint propCode)
        {
            uint resp;
            var data = ExecuteReadData(PTP_OC_GET_DEVICE_PROP_VALUE, out resp, propCode);
            if (resp != PTP_RC_OK || data == null || data.Length < 2) return "";
            int len = data[0];
            if (len <= 1 || data.Length < 1 + len * 2) return "";
            return Encoding.Unicode.GetString(data, 1, (len - 1) * 2).TrimEnd('\0');
        }

        private void WaitForReady(int maxWaitMs)
        {
            var deadline = Stopwatch.StartNew();
            while (deadline.ElapsedMilliseconds < maxWaitMs)
            {
                uint rc = ExecuteNoData(PTP_OC_NIKON_DEVICE_READY);
                if (rc == PTP_RC_OK) return;
                if (rc != PTP_RC_DEVICE_BUSY) return;
                Thread.Sleep(40);
            }
        }

        private List<KeyValuePair<ushort, uint>> PollEvents()
        {
            var list = new List<KeyValuePair<ushort, uint>>();
            uint resp;
            var ev = ExecuteReadData(PTP_OC_NIKON_GET_EVENT, out resp);
            if (resp != PTP_RC_OK || ev == null || ev.Length < 2) return list;
            ushort count = BitConverter.ToUInt16(ev, 0);
            int off = 2;
            for (int i = 0; i < count && off + 6 <= ev.Length; i++)
            {
                ushort code = BitConverter.ToUInt16(ev, off);
                uint param = BitConverter.ToUInt32(ev, off + 2);
                off += 6;
                list.Add(new KeyValuePair<ushort, uint>(code, param));
            }
            return list;
        }

        public NikonStatusResult GetStatus()
        {
            try
            {
                EnsureConnected();
                uint resp;
                int battery = -1;
                var batBytes = ExecuteReadData(PTP_OC_GET_DEVICE_PROP_VALUE, out resp, 0x5001);
                if (resp == PTP_RC_OK && batBytes != null && batBytes.Length > 0) battery = batBytes[0];
                string imageSize = ReadPtpStringProp(0x5003);
                string detail = string.IsNullOrEmpty(imageSize) ? "" : " (" + imageSize + (battery >= 0 ? ", " + battery + "% battery" : "") + ")";
                return new NikonStatusResult
                {
                    Connected = true,
                    Model = this.deviceModel ?? "Nikon DSLR",
                    BatteryPercent = battery,
                    ImageSize = imageSize,
                    Message = "Nikon " + (this.deviceModel ?? "DSLR") + " is ready on USB" + detail + "."
                };
            }
            catch (NikonProtocolException ex)
            {
                return new NikonStatusResult
                {
                    Connected = false,
                    Model = "",
                    BatteryPercent = -1,
                    ImageSize = "",
                    Message = ex.Message
                };
            }
            catch (Exception ex)
            {
                Disconnect();
                return new NikonStatusResult
                {
                    Connected = false,
                    Model = "",
                    BatteryPercent = -1,
                    ImageSize = "",
                    Message = "Nikon USB camera is disconnected: " + ex.Message
                };
            }
        }

        public void StartLiveView()
        {
            EnsureConnected();
            if (this.liveViewActive) return;

            uint rc = ExecuteNoData(PTP_OC_NIKON_START_LIVE_VIEW);
            if (rc == PTP_RC_DEVICE_BUSY)
            {
                WaitForReady(1000);
                rc = ExecuteNoData(PTP_OC_NIKON_START_LIVE_VIEW);
            }
            if (rc == PTP_RC_OK)
            {
                this.liveViewActive = true;
                return;
            }
            throw new NikonProtocolException(
                "nikon_liveview_failed",
                "Could not start Nikon Live View (PTP 0x" + rc.ToString("X4") + "). Check that the camera is in M/A/S/P mode and ready.");
        }

        public void StopLiveView()
        {
            if (this.device != null && this.liveViewActive)
            {
                try { ExecuteNoData(PTP_OC_NIKON_END_LIVE_VIEW); } catch { }
            }
            this.liveViewActive = false;
        }

        public NikonLiveViewFrameResult GetLiveViewFrame()
        {
            EnsureConnected();
            if (!this.liveViewActive)
            {
                StartLiveView();
            }

            uint resp;
            var raw = ExecuteReadData(PTP_OC_NIKON_GET_LIVE_VIEW_IMG, out resp);
            if (resp == PTP_RC_DEVICE_BUSY)
            {
                return new NikonLiveViewFrameResult { Skipped = true, JpegBase64 = "", Width = 0, Height = 0 };
            }
            if (resp != PTP_RC_OK)
            {
                this.liveViewActive = false;
                return new NikonLiveViewFrameResult { Skipped = true, JpegBase64 = "", Width = 0, Height = 0 };
            }
            if (raw == null || raw.Length <= 384)
            {
                return new NikonLiveViewFrameResult { Skipped = true, JpegBase64 = "", Width = 0, Height = 0 };
            }

            int soi = -1;
            int searchLimit = Math.Min(raw.Length - 3, 512);
            for (int j = 0; j < searchLimit; j++)
            {
                if (raw[j] == 0xFF && raw[j + 1] == 0xD8 && raw[j + 2] == 0xFF)
                {
                    soi = j;
                    break;
                }
            }
            if (soi < 0)
            {
                return new NikonLiveViewFrameResult { Skipped = true, JpegBase64 = "", Width = 0, Height = 0 };
            }

            int jpgLen = raw.Length - soi;
            var jpg = new byte[jpgLen];
            Buffer.BlockCopy(raw, soi, jpg, 0, jpgLen);

            int width = 640;
            int height = 424;
            int pos = 2;
            while (pos + 3 < jpg.Length)
            {
                if (jpg[pos] != 0xFF) break;
                while (pos < jpg.Length && jpg[pos] == 0xFF) pos++;
                if (pos >= jpg.Length) break;
                byte marker = jpg[pos];
                if (marker == 0xC0 || marker == 0xC2)
                {
                    if (pos + 7 < jpg.Length)
                    {
                        height = (jpg[pos + 4] << 8) | jpg[pos + 5];
                        width = (jpg[pos + 6] << 8) | jpg[pos + 7];
                    }
                    break;
                }
                if (marker == 0xDA || marker == 0xD9) break;
                if (marker == 0x00 || (marker >= 0xD0 && marker <= 0xD7))
                {
                    pos++;
                    continue;
                }
                if (pos + 2 >= jpg.Length) break;
                int segLen = (jpg[pos + 1] << 8) | jpg[pos + 2];
                if (segLen < 2) break;
                pos += 1 + segLen;
            }
            if (width <= 0 || height <= 0)
            {
                width = 640;
                height = 424;
            }

            return new NikonLiveViewFrameResult
            {
                Skipped = false,
                JpegBase64 = Convert.ToBase64String(jpg),
                Width = width,
                Height = height
            };
        }

        public NikonCaptureResult Capture(string outputPath, int timeoutMs)
        {
            if (string.IsNullOrEmpty(outputPath))
            {
                throw new NikonProtocolException("capture_path_invalid", "Capture output path is required.");
            }
            if (timeoutMs < 3000) timeoutMs = 15000;

            var sw = Stopwatch.StartNew();
            try
            {
                EnsureConnected();
            }
            catch (NikonProtocolException)
            {
                throw;
            }
            catch
            {
                Disconnect();
                EnsureConnected();
            }

            if (this.liveViewActive)
            {
                try { ExecuteNoData(PTP_OC_NIKON_END_LIVE_VIEW); } catch { }
                this.liveViewActive = false;
                Thread.Sleep(150);
            }

            // Drain any stale events or uncollected SDRAM objects left from an aborted capture.
            foreach (var ev in PollEvents())
            {
                if (ev.Key == PTP_EC_NIKON_OBJECT_ADDED_IN_SDRAM && ev.Value != 0)
                {
                    uint discardResp;
                    ExecuteReadData(PTP_OC_GET_OBJECT_INFO, out discardResp, ev.Value);
                    ExecuteReadData(PTP_OC_GET_OBJECT, out discardResp, ev.Value);
                }
            }

            WaitForReady(3000);

            // Nikon InitiateCaptureRecInMedia (0x9207): param1=0xFFFFFFFF (no AF stall), param2=0x00000001 (SDRAM).
            uint capResp = ExecuteNoData(PTP_OC_NIKON_INITIATE_CAPTURE_MEDIA, 0xFFFFFFFF, 0x00000001);
            if (capResp == PTP_RC_OPERATION_NOT_SUPPORTED)
            {
                capResp = ExecuteNoData(PTP_OC_NIKON_INITIATE_CAPTURE_SDRAM);
            }
            if (capResp == PTP_RC_DEVICE_BUSY)
            {
                WaitForReady(2000);
                capResp = ExecuteNoData(PTP_OC_NIKON_INITIATE_CAPTURE_MEDIA, 0xFFFFFFFF, 0x00000001);
            }
            if (capResp != PTP_RC_OK)
            {
                throw new NikonProtocolException(
                    "nikon_capture_failed",
                    "Nikon shutter release was rejected (PTP 0x" + capResp.ToString("X4") + "). Check that the camera is in M/A/S/P mode and ready.");
            }

            uint objectHandle = 0;
            while (sw.ElapsedMilliseconds < timeoutMs && objectHandle == 0)
            {
                foreach (var ev in PollEvents())
                {
                    if (ev.Key == PTP_EC_NIKON_OBJECT_ADDED_IN_SDRAM || ev.Key == PTP_EC_OBJECT_ADDED)
                    {
                        objectHandle = ev.Value;
                        break;
                    }
                }
                if (objectHandle == 0) Thread.Sleep(40);
            }

            if (objectHandle == 0)
            {
                throw new NikonProtocolException("camera_timeout", "Timed out waiting for the Nikon camera photo over USB.");
            }

            WaitForReady(3000);

            uint infoResp;
            var objInfo = ExecuteReadData(PTP_OC_GET_OBJECT_INFO, out infoResp, objectHandle);
            if (infoResp != PTP_RC_OK || objInfo == null)
            {
                throw new NikonProtocolException("nikon_object_info_failed", "Could not read Nikon photo metadata (PTP 0x" + infoResp.ToString("X4") + ").");
            }

            uint objResp;
            var jpg = ExecuteReadData(PTP_OC_GET_OBJECT, out objResp, objectHandle);
            if (objResp != PTP_RC_OK || jpg == null || jpg.Length < 4 || jpg[0] != 0xFF || jpg[1] != 0xD8 || jpg[2] != 0xFF)
            {
                throw new NikonProtocolException("capture_format", "The Nikon camera did not return a valid JPEG photo. Set Image Quality to JPEG (not RAW-only).");
            }

            string dir = Path.GetDirectoryName(outputPath);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            string tmpPath = outputPath + ".tmp";
            File.WriteAllBytes(tmpPath, jpg);
            if (File.Exists(outputPath)) File.Delete(outputPath);
            File.Move(tmpPath, outputPath);

            return new NikonCaptureResult
            {
                Path = outputPath,
                Bytes = jpg.Length,
                ElapsedMs = sw.ElapsedMilliseconds,
                Model = this.deviceModel ?? "Nikon DSLR"
            };
        }
    }
}
'@

Add-Type -TypeDefinition $csharpSource -Language CSharp

$client = New-Object GraceBoothNikon.NikonClient

function Send($payload) {
  [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $id = $null
  try {
    $request = $line | ConvertFrom-Json
    $id = $request.id
    $data = switch ($request.op) {
      'status' {
        $s = $client.GetStatus()
        [ordered]@{
          connected = [bool]$s.Connected
          model = [string]$s.Model
          batteryPercent = [int]$s.BatteryPercent
          imageSize = [string]$s.ImageSize
          message = [string]$s.Message
        }
      }
      'capture' {
        $timeout = if ($null -ne $request.timeoutMs) { [int]$request.timeoutMs } else { 15000 }
        $r = $client.Capture([string]$request.outputPath, $timeout)
        [ordered]@{
          path = [string]$r.Path
          bytes = [int]$r.Bytes
          elapsedMs = [long]$r.ElapsedMs
          model = [string]$r.Model
        }
      }
      'liveview_start' {
        $client.StartLiveView()
        [ordered]@{ active = $true }
      }
      'liveview_frame' {
        $f = $client.GetLiveViewFrame()
        if ($f.Skipped) {
          [ordered]@{ skipped = $true }
        } else {
          [ordered]@{
            skipped = $false
            jpegBase64 = [string]$f.JpegBase64
            width = [int]$f.Width
            height = [int]$f.Height
          }
        }
      }
      'liveview_stop' {
        $client.StopLiveView()
        [ordered]@{ active = $false }
      }
      'disconnect' {
        $client.Disconnect()
        [ordered]@{ disconnected = $true }
      }
      default {
        throw [GraceBoothNikon.NikonProtocolException]::new('unknown_op', "Unknown camera helper operation '$($request.op)'.")
      }
    }
    Send ([ordered]@{ id = $id; ok = $true; data = $data })
  } catch {
    $ex = $_.Exception
    while ($null -ne $ex.InnerException -and -not ($ex -is [GraceBoothNikon.NikonProtocolException])) {
      $ex = $ex.InnerException
    }
    if ($ex -is [GraceBoothNikon.NikonProtocolException]) {
      Send ([ordered]@{ id = $id; ok = $false; code = $ex.Code; message = $ex.Message })
    } else {
      $client.Disconnect()
      Send ([ordered]@{ id = $id; ok = $false; code = 'nikon_helper_error'; message = $ex.Message })
    }
  }
}

$client.Disconnect()
