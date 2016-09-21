// +build windows

package main

import (
	"syscall"
	"unsafe"
)

// Get the Windows terminal size
// See: https://groups.google.com/d/msg/golang-nuts/lQRDFwhS650/ZH7GMEj-h2gJ
func getWindowsTerminalSize() (int, int, error) {
	modkernel32 := syscall.NewLazyDLL("kernel32.dll")
	procGetConScrBufInfo := modkernel32.NewProc("GetConsoleScreenBufferInfo")

	hCon, err := syscall.Open("CONOUT$", syscall.O_RDONLY, 0)
	if err != nil {
		return 0, 0, err
	}
	defer syscall.Close(hCon)

	var sb consoleScreenBuffer
	rc, _, ec := syscall.Syscall(procGetConScrBufInfo.Addr(), 2,
		uintptr(hCon), uintptr(unsafe.Pointer(&sb)), 0)
	if rc == 0 {
		return 0, 0, syscall.Errno(ec)
	}
	return int(sb.size.x), int(sb.size.y), nil
}

type coord struct {
	x int16
	y int16
}

type smallRect struct {
	left   int16
	top    int16
	right  int16
	bottom int16
}

type consoleScreenBuffer struct {
	size       coord
	cursorPos  coord
	attrs      int32
	window     smallRect
	maxWinSize coord
}
