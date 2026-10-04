const { spawnSync } = require("child_process");

const POWERSHELL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class JobSearchCredentialStore {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct Credential {
        public uint Flags;
        public uint Type;
        public IntPtr TargetName;
        public IntPtr Comment;
        public long LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public IntPtr TargetAlias;
        public IntPtr UserName;
    }

    [DllImport("Advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredWrite(ref Credential credential, uint flags);

    [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

    [DllImport("Advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredDelete(string target, uint type, uint flags);

    [DllImport("Advapi32.dll", EntryPoint = "CredFree", SetLastError = false)]
    public static extern void CredFree(IntPtr buffer);

    public static void Clear(IntPtr address, int length) {
        if (address == IntPtr.Zero || length <= 0) return;
        byte[] zeros = new byte[length];
        Marshal.Copy(zeros, 0, address, length);
    }
}
'@

try {
    $requestJson = [Console]::In.ReadLine()
    $request = ConvertFrom-Json -InputObject $requestJson
    $credentialType = 1

    switch ($request.operation) {
        'write' {
            $targetPointer = [Runtime.InteropServices.Marshal]::StringToHGlobalUni([string]$request.target)
            $usernamePointer = [Runtime.InteropServices.Marshal]::StringToHGlobalUni([string]$request.username)
            $passwordBytes = [Text.Encoding]::Unicode.GetBytes([string]$request.password)
            $passwordPointer = [Runtime.InteropServices.Marshal]::AllocHGlobal($passwordBytes.Length)
            try {
                [Runtime.InteropServices.Marshal]::Copy($passwordBytes, 0, $passwordPointer, $passwordBytes.Length)
                $credential = New-Object JobSearchCredentialStore+Credential
                $credential.Type = $credentialType
                $credential.TargetName = $targetPointer
                $credential.UserName = $usernamePointer
                $credential.CredentialBlob = $passwordPointer
                $credential.CredentialBlobSize = [uint32]$passwordBytes.Length
                $credential.Persist = 2
                if (-not [JobSearchCredentialStore]::CredWrite([ref]$credential, 0)) {
                    throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
                }
                [Console]::Out.WriteLine('{"ok":true}')
            } finally {
                [JobSearchCredentialStore]::Clear($passwordPointer, $passwordBytes.Length)
                [Runtime.InteropServices.Marshal]::FreeHGlobal($passwordPointer)
                [Runtime.InteropServices.Marshal]::FreeHGlobal($usernamePointer)
                [Runtime.InteropServices.Marshal]::FreeHGlobal($targetPointer)
                [Array]::Clear($passwordBytes, 0, $passwordBytes.Length)
            }
        }
        'read' {
            $credentialPointer = [IntPtr]::Zero
            if (-not [JobSearchCredentialStore]::CredRead([string]$request.target, $credentialType, 0, [ref]$credentialPointer)) {
                $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
                if ($errorCode -eq 1168) {
                    [Console]::Out.WriteLine('null')
                } else {
                    throw [ComponentModel.Win32Exception]::new($errorCode)
                }
            } else {
                try {
                    $credential = [Runtime.InteropServices.Marshal]::PtrToStructure(
                        $credentialPointer,
                        [type][JobSearchCredentialStore+Credential]
                    )
                    $passwordBytes = New-Object byte[] $credential.CredentialBlobSize
                    [Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob, $passwordBytes, 0, $passwordBytes.Length)
                    try {
                        $password = [Text.Encoding]::Unicode.GetString($passwordBytes)
                        $response = @{ username = [Runtime.InteropServices.Marshal]::PtrToStringUni($credential.UserName); password = $password }
                        [Console]::Out.WriteLine((ConvertTo-Json -InputObject $response -Compress))
                    } finally {
                        [Array]::Clear($passwordBytes, 0, $passwordBytes.Length)
                    }
                } finally {
                    [JobSearchCredentialStore]::CredFree($credentialPointer)
                }
            }
        }
        'delete' {
            if (-not [JobSearchCredentialStore]::CredDelete([string]$request.target, $credentialType, 0)) {
                $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
                if ($errorCode -ne 1168) {
                    throw [ComponentModel.Win32Exception]::new($errorCode)
                }
            }
            [Console]::Out.WriteLine('{"ok":true}')
        }
        default { throw 'Unsupported Windows Credential Manager operation.' }
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
`;

function runCredentialCommand(request) {
  if (process.platform !== "win32") {
    throw new Error("Windows Credential Manager is available only on Windows.");
  }

  const encodedScript = Buffer.from(POWERSHELL_SCRIPT, "utf16le").toString("base64");
  const result = spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    encodedScript
  ], {
    input: `${JSON.stringify(request)}\n`,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });

  if (result.error) throw new Error(`Windows Credential Manager is unavailable: ${result.error.message}`);
  if (result.status !== 0) {
    const reason = result.stderr.trim() || "Credential operation failed.";
    throw new Error(`Windows Credential Manager operation failed: ${reason}`);
  }

  return result.stdout.trim();
}

function validateCredentialInput({ target, username, password }) {
  if (!target || !username || !password) {
    throw new TypeError("Credential target, username, and password are required.");
  }
}

function setCredential({ target, username, password }) {
  validateCredentialInput({ target, username, password });
  runCredentialCommand({ operation: "write", target, username, password });
}

function getCredential(target) {
  if (!target) throw new TypeError("Credential target is required.");
  const output = runCredentialCommand({ operation: "read", target });
  return output === "null" ? null : JSON.parse(output);
}

function deleteCredential(target) {
  if (!target) throw new TypeError("Credential target is required.");
  runCredentialCommand({ operation: "delete", target });
}

module.exports = { deleteCredential, getCredential, setCredential };
