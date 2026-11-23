' Launches StudyMedia Sidecar completely invisibly (zero console/taskbar window)
' Passing True to Run keeps wscript.exe alive so Task Scheduler accurately tracks Running state.
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
psScript = fso.BuildPath(scriptDir, "start-sidecar.ps1")

Set shell = CreateObject("WScript.Shell")
cmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & psScript & """"
shell.Run cmd, 0, True
