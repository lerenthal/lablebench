#!/bin/sh
# Unbind the kernel's USB printer driver from a printer's interface.
#
# The browser has to claim the interface itself, and the kernel's printer
# driver (usblp) holds it. The browser will not detach a kernel driver — it
# refuses the claim instead, with "Unable to claim interface" — so the
# interface has to be free before the printer is plugged in.
#
# CUPS is not affected by this: its USB backend talks to the device through
# libusb and detaches the kernel driver itself when it needs the interface.
#
# The vendor is checked here rather than in the rule, so the rule cannot
# match the wrong device and the check cannot drift from the rule.

set -e

interface="$1"

[ -n "$interface" ] || exit 0

sysfs="/sys/bus/usb/devices/$interface"

[ -d "$sysfs" ] || exit 0

# Only for the printer vendor the app drives directly over the browser.
vendor=$(cat "$sysfs/../idVendor" 2>/dev/null || echo "")

if [ "$vendor" != "0922" ]; then
  exit 0
fi

driver="/sys/bus/usb/drivers/usblp"

[ -d "$driver" ] || exit 0

# Already free, or never held by the printer driver.
[ -e "$driver/$interface" ] || exit 0

echo "$interface" > "$driver/unbind" 2>/dev/null || true
