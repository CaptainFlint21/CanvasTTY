{
  "targets": [
    {
      "target_name": "canvastty-windows-agent-pipe-host",
      "type": "executable",
      "sources": ["src/main.cc"],
      "libraries": ["-ladvapi32", "-lbcrypt"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": ["/std:c++20", "/W4", "/permissive-", "/guard:cf", "/sdl"],
          "RuntimeLibrary": 0
        },
        "VCLinkerTool": {
          "SubSystem": 1,
          "AdditionalOptions": ["/DYNAMICBASE", "/NXCOMPAT", "/guard:cf"]
        }
      }
    }
  ]
}
