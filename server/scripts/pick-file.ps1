# Native "open file" dialog for video files, invoked by the server (see
# server/src/index.js's pickFileNative()) so it can learn the real absolute
# path — something a browser tab is never allowed to see for a file the user
# picks. Must run in STA (the caller passes -STA); WinForms dialogs need it.
#
# Prints the chosen absolute path to stdout, or nothing if the user cancels.

Add-Type -AssemblyName System.Windows.Forms

$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Filter = 'Video files (*.mp4;*.mov;*.mkv;*.webm)|*.mp4;*.mov;*.mkv;*.webm|All files (*.*)|*.*'
$dialog.Title = 'Select video'
$dialog.CheckFileExists = $true

if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.FileName
}
