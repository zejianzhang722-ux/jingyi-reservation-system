Option Explicit
Dim fso, shell, root, adminDir, node, vite, errorLog, quote, inner, command, result
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
adminDir = fso.BuildPath(root, "admin")
node = fso.BuildPath(root, "nodejs\node.exe")
vite = fso.BuildPath(adminDir, "node_modules\vite\bin\vite.js")
errorLog = fso.BuildPath(root, "admin-error.log")
If Not fso.FileExists(node) Or Not fso.FileExists(vite) Then WScript.Quit 1
shell.CurrentDirectory = adminDir
quote = Chr(34)
inner = quote & node & quote & " " & quote & vite & quote & " --host 127.0.0.1 --port 5173 --strictPort 1>nul 2>>" & quote & errorLog & quote
command = "cmd.exe /d /s /c " & quote & inner & quote
result = shell.Run(command, 0, True)
WScript.Quit result
