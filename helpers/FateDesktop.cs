using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace FateCollector {
 sealed class DesktopForm : Form {
  public Action RequestExit;
  protected override void WndProc(ref Message message) {
   if(message.Msg==0x8461) { if(RequestExit!=null) RequestExit(); return; }
   if(message.Msg==0x0010) { Hide(); return; }
   base.WndProc(ref message);
  }
 }
 public sealed class DesktopHost : ApplicationContext {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool SetDllDirectory(string path);
  const int OverlayLimit=32768, CaptureLimit=12*1024*1024;
  static readonly Regex CaptureName=new Regex(@"\A(?:auto-)?fate-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json\z",RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
  static readonly HashSet<string> OverlayFiles=new HashSet<string>(new[]{"state.json","capture.json","command.json"},StringComparer.Ordinal);
  readonly string root, captures, profile; readonly Process parent; readonly Form form; readonly WebView2 view; readonly System.Windows.Forms.Timer timer; readonly JavaScriptSerializer json;
  bool ready, tickInFlight, exiting, failed; int tickErrors;
  DesktopHost(string root,string profile,Process parent) {
   this.root=Path.GetFullPath(root); captures=Path.Combine(this.root,"captures"); this.profile=profile; this.parent=parent;
   json=new JavaScriptSerializer { MaxJsonLength=CaptureLimit+1024*1024, RecursionLimit=32 };
   var desktopForm=new DesktopForm { Text="Fate Collector \u2014 Local", Width=1200, Height=800, StartPosition=FormStartPosition.CenterScreen, ShowInTaskbar=true };
   desktopForm.RequestExit=Exit; form=desktopForm;
   form.FormClosing += delegate(object sender,FormClosingEventArgs e) { if(!exiting && e.CloseReason==CloseReason.UserClosing) { e.Cancel=true; form.Hide(); } };
   form.FormClosed += delegate { if(!exiting) { failed=true; Console.Error.WriteLine("Fate Collector local desktop window closed unexpectedly."); Exit(); } };
   view=new WebView2 { Dock=DockStyle.Fill }; form.Controls.Add(view);
   timer=new System.Windows.Forms.Timer { Interval=500 }; timer.Tick+=Tick; timer.Start();
   form.CreateControl(); var ignored=form.Handle;
   form.BeginInvoke((Action)(async delegate { await Initialize(); }));
  }
  public static int Run(string root,string profile,Process parent) {
   string arch=IntPtr.Size==8 ? "x64" : "x86";
   if(!SetDllDirectory(Path.Combine(root,"webview2",arch))) throw new System.ComponentModel.Win32Exception();
   string canonical=Path.GetFullPath(profile).TrimEnd(Path.DirectorySeparatorChar,Path.AltDirectorySeparatorChar).ToUpperInvariant();
   string name; using(var sha=SHA256.Create()) name="Local\\FateCollectorDesktop-"+BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(canonical))).Replace("-","");
   bool created; using(var mutex=new Mutex(false,name,out created)) {
    if(!created) throw new InvalidOperationException("This desktop profile is already in use.");
    Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
    var host=new DesktopHost(root,profile,parent);
    Application.Run(host);
    return host.failed ? 1 : 0;
   }
  }
  async Task Initialize() {
   try {
    if(parent.HasExited) { Exit(); return; }
    Directory.CreateDirectory(profile);
    var environment=await CoreWebView2Environment.CreateAsync(null,profile);
    await view.EnsureCoreWebView2Async(environment);
    var core=view.CoreWebView2;
    await core.AddScriptToExecuteOnDocumentCreatedAsync("Object.defineProperty(window, '__fateCollectorDesktop', { value: 1 });");
    core.Settings.AreDevToolsEnabled=false; core.Settings.AreDefaultContextMenusEnabled=false;
    core.Settings.AreHostObjectsAllowed=false;
    core.NavigationStarting += delegate(object s,CoreWebView2NavigationStartingEventArgs e) { if(!Local(e.Uri)) e.Cancel=true; };
    core.NewWindowRequested += delegate(object s,CoreWebView2NewWindowRequestedEventArgs e) { e.Handled=true; };
    core.AddWebResourceRequestedFilter("*",CoreWebView2WebResourceContext.All,CoreWebView2WebResourceRequestSourceKinds.All);
    core.WebResourceRequested += delegate(object s,CoreWebView2WebResourceRequestedEventArgs e) {
     string uri=e.Request.Uri;
     bool localBlob=uri.StartsWith("blob:https://fate.local/",StringComparison.OrdinalIgnoreCase);
     bool localImage=e.ResourceContext==CoreWebView2WebResourceContext.Image && uri.StartsWith("data:image/",StringComparison.OrdinalIgnoreCase);
     if(!Local(uri) && !localBlob && !localImage) e.Response=environment.CreateWebResourceResponse(null,403,"Forbidden","Content-Type: text/plain\r\n");
    };
    core.WebMessageReceived += Message;
    core.SetVirtualHostNameToFolderMapping("fate.local",Path.Combine(root,"desktop"),CoreWebView2HostResourceAccessKind.Deny);
    core.Navigate("https://fate.local/index.html"); ready=true;
   } catch(Exception) { Console.Error.WriteLine("Fate Collector could not start the local desktop. Check that Microsoft Edge WebView2 Runtime is installed."); failed=true; Exit(); }
  }
  static bool Local(string value) { Uri u; return Uri.TryCreate(value,UriKind.Absolute,out u) && u.Scheme==Uri.UriSchemeHttps && u.Host=="fate.local" && u.Port==443 && String.IsNullOrEmpty(u.UserInfo); }
  async void Tick(object sender,EventArgs e) {
   try { if(parent.HasExited) { Exit(); return; } } catch { Exit(); return; }
   if(!ready || tickInFlight) return;
   if(view.IsDisposed || view.CoreWebView2==null) { failed=true; Console.Error.WriteLine("Fate Collector local desktop stopped unexpectedly."); Exit(); return; }
   tickInFlight=true;
   try { await view.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new Event('fate-desktop-tick'))"); tickErrors=0; }
   catch { if(++tickErrors>=3) { failed=true; Console.Error.WriteLine("Fate Collector local desktop stopped responding."); Exit(); } }
   finally { tickInFlight=false; }
  }
  void Exit() { if(exiting) return; exiting=true; timer.Stop(); view.Dispose(); form.Close(); form.Dispose(); ExitThread(); }
  void Message(object sender,CoreWebView2WebMessageReceivedEventArgs e) {
   if(!Local(e.Source)) return;
   string id=null;
   try {
    if(e.WebMessageAsJson.Length>OverlayLimit*2) return;
    var request=json.DeserializeObject(e.WebMessageAsJson) as Dictionary<string,object>;
    if(request==null || !request.ContainsKey("id") || !(request["id"] is string)) return;
    id=(string)request["id"]; Guid parsed;
    if(!Guid.TryParseExact(id,"D",out parsed) || !request.ContainsKey("protocol") || Convert.ToString(request["protocol"])!="1" || !request.ContainsKey("operation") || !(request["operation"] is string)) return;
    object value=Operate((string)request["operation"],request);
    Reply(new { protocol=1,id=id,ok=true,value=value });
   } catch(FileNotFoundException) { Error(id,"NotFoundError","File not found."); }
     catch(DirectoryNotFoundException) { Error(id,"NotFoundError","Directory not found."); }
     catch(UnauthorizedAccessException) { Error(id,"NotAllowedError","Access denied."); }
     catch(ArgumentException) { Error(id,"NotAllowedError","Invalid request."); }
     catch(Exception) { Error(id,"OperationError","The operation failed."); }
  }
  void Error(string id,string code,string message) { if(id!=null) Reply(new { protocol=1,id=id,ok=false,error=new { code=code,message=message } }); }
  void Reply(object value) { view.CoreWebView2.PostWebMessageAsJson(json.Serialize(value)); }
  static string Field(Dictionary<string,object> request,string key) { object value; if(!request.TryGetValue(key,out value) || !(value is string)) throw new ArgumentException(); return (string)value; }
  object Operate(string op,Dictionary<string,object> request) {
   if(op=="ready") return new { helperVersion="0.10.9" };
   if(op=="show") { form.Show(); form.WindowState=FormWindowState.Normal; form.Activate(); return null; }
   if(op=="hide") { form.Hide(); return null; }
   if(op=="list") return List(Field(request,"path"));
   if(op=="read") return Read(Field(request,"path"));
   if(op=="write") { Write(Field(request,"path"),Field(request,"content")); return null; }
   throw new ArgumentException();
  }
  void CheckDirectory(string path) {
   var info=new DirectoryInfo(path); if(!info.Exists) throw new DirectoryNotFoundException();
   if((info.Attributes & FileAttributes.ReparsePoint)!=0) throw new UnauthorizedAccessException();
  }
  string DirectoryFor(string path) {
   CheckDirectory(captures);
   if(path=="captures") return captures;
   if(path=="captures/.overlay") { string dir=Path.Combine(captures,".overlay"); CheckDirectory(dir); return dir; }
   throw new ArgumentException();
  }
  string FileFor(string path,out int limit) {
   string prefix="captures/"; if(!path.StartsWith(prefix,StringComparison.Ordinal)) throw new ArgumentException();
   string rest=path.Substring(prefix.Length); string dir;
   if(rest.StartsWith(".overlay/",StringComparison.Ordinal)) { string name=rest.Substring(9); if(!OverlayFiles.Contains(name)) throw new ArgumentException(); dir=DirectoryFor("captures/.overlay"); rest=name; limit=OverlayLimit; }
   else { if(!CaptureName.IsMatch(rest)) throw new ArgumentException(); dir=DirectoryFor("captures"); limit=CaptureLimit; }
   string file=Path.Combine(dir,rest); if(File.Exists(file) && (File.GetAttributes(file)&FileAttributes.ReparsePoint)!=0) throw new UnauthorizedAccessException(); return file;
  }
  object List(string path) {
   string dir=DirectoryFor(path); var items=new List<object>();
   foreach(string entry in Directory.GetFileSystemEntries(dir)) {
    var attributes=File.GetAttributes(entry); if((attributes&FileAttributes.ReparsePoint)!=0) continue;
    string name=Path.GetFileName(entry); bool directory=(attributes&FileAttributes.Directory)!=0;
    if(path=="captures" && ((directory && name==".overlay") || (!directory && CaptureName.IsMatch(name))) || path=="captures/.overlay" && !directory && OverlayFiles.Contains(name)) items.Add(new {kind=directory ? "directory" : "file",name=name});
   }
   return items.ToArray();
  }
  object Read(string path) {
   int limit; string file=FileFor(path,out limit);
   using(var stream=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.Read|FileShare.Delete)) {
    if(stream.Length>limit) throw new IOException();
    using(var reader=new StreamReader(stream,new UTF8Encoding(false,true),true)) { string text=reader.ReadToEnd(); long modified=new DateTimeOffset(File.GetLastWriteTimeUtc(file)).ToUnixTimeMilliseconds(); return new { text=text,lastModified=modified }; }
   }
  }
  void Write(string path,string content) {
   if(path!="captures/.overlay/state.json") throw new ArgumentException(); int limit; string file=FileFor(path,out limit);
   byte[] bytes=new UTF8Encoding(false,true).GetBytes(content); if(bytes.Length>limit) throw new IOException();
   string temporary=Path.Combine(Path.GetDirectoryName(file),".desktop-"+Guid.NewGuid().ToString("N")+".tmp");
   try { using(var stream=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None)) stream.Write(bytes,0,bytes.Length); if(File.Exists(file)) File.Replace(temporary,file,null); else File.Move(temporary,file); }
   finally { if(File.Exists(temporary)) File.Delete(temporary); }
  }
 }
}
