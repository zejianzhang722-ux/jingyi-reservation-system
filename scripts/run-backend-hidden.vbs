Option Explicit
Dim fso, shell, root, node, app, errorLog, quote, inner, command, result
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
node = fso.BuildPath(root, "nodejs\node.exe")
app = fso.BuildPath(root, "server\src\app.js")
errorLog = fso.BuildPath(root, "backend-error.log")
If Not fso.FileExists(node) Or Not fso.FileExists(app) Then WScript.Quit 1
quote = Chr(34)
inner = quote & node & quote & " " & quote & app & quote & " 1>nul 2>>" & quote & errorLog & quote
command = "cmd.exe /d /s /c " & quote & inner & quote
result = shell.Run(command, 0, True)
WScript.Quit result
