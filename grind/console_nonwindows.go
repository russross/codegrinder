// +build !windows

package main

func getWindowsTerminalSize() (int, int, error) {
	panic("this should only be called from Windows")
}
