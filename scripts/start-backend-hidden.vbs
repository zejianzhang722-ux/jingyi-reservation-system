Option Explicit
Dim fso, shell, root, script, logFile, quote, command
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
script = fso.BuildPath(root, "scripts\start-backend-on-demand.ps1")
logFile = fso.BuildPath(root, "backend-startup.log")
If Not fso.FileExists(script) Then WScript.Quit 1
quote = Chr(34)
command = "cmd.exe /d /c " & quote & "powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & quote & script & quote & " >> " & quote & logFile & quote & " 2>&1" & quote
shell.Run command, 0, False
