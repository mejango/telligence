// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Parses only canonical UTC timestamps with millisecond precision for authentication challenges.
library TelligenceDateTime {
    //*********************************************************************//
    // ---------------------- internal functions ------------------------- //
    //*********************************************************************//

    /// @notice Validates a Gregorian timestamp and converts it into Unix milliseconds.
    /// @dev Restricting delimiters and length prevents extra SIWE fields and timezone ambiguity.
    /// @param timestamp The exact `YYYY-MM-DDTHH:mm:ss.sssZ` bytes.
    /// @return valid Whether the timestamp is canonical and within years 1970 through 9999.
    /// @return milliseconds The Unix time when valid, or zero otherwise.
    function parseMilliseconds(bytes memory timestamp) internal pure returns (bool valid, uint256 milliseconds) {
        if (
            timestamp.length != 24 || timestamp[4] != "-" || timestamp[7] != "-" || timestamp[10] != "T"
                || timestamp[13] != ":" || timestamp[16] != ":" || timestamp[19] != "." || timestamp[23] != "Z"
        ) return (false, 0);

        // Every non-delimiter byte must be decimal so reconstruction cannot inject SIWE lines or Unicode.
        for (uint256 i; i < 23; i++) {
            if (i == 4 || i == 7 || i == 10 || i == 13 || i == 16 || i == 19) continue;
            if (timestamp[i] < "0" || timestamp[i] > "9") return (false, 0);
        }

        uint256 year = _number({text: timestamp, start: 0, length: 4});
        uint256 month = _number({text: timestamp, start: 5, length: 2});
        uint256 day = _number({text: timestamp, start: 8, length: 2});
        uint256 hour = _number({text: timestamp, start: 11, length: 2});
        uint256 minute = _number({text: timestamp, start: 14, length: 2});
        uint256 second = _number({text: timestamp, start: 17, length: 2});
        if (year < 1970 || month == 0 || month > 12 || day == 0 || hour > 23 || minute > 59 || second > 59) {
            return (false, 0);
        }

        // Gregorian century rules matter even though each authentication window lasts at most five minutes.
        bool leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
        uint256[12] memory monthDays = [uint256(31), leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        if (day > monthDays[month - 1]) return (false, 0);
        uint256 previousYear = year - 1;
        uint256 daysSinceEpoch = (year - 1970) * 365 + previousYear / 4 - previousYear / 100 + previousYear / 400 - 477;
        for (uint256 i; i < month - 1; i++) {
            daysSinceEpoch += monthDays[i];
        }
        daysSinceEpoch += day - 1;
        milliseconds = ((daysSinceEpoch * 24 + hour) * 60 + minute) * 60_000 + second * 1000
            + _number({text: timestamp, start: 20, length: 3});
        return (true, milliseconds);
    }

    //*********************************************************************//
    // ----------------------- private helpers --------------------------- //
    //*********************************************************************//

    /// @notice Reads a decimal component from already validated timestamp bytes.
    /// @param text The canonical timestamp bytes.
    /// @param start The first byte of the component.
    /// @param length The component's byte count.
    /// @return value The decimal value.
    function _number(bytes memory text, uint256 start, uint256 length) private pure returns (uint256 value) {
        for (uint256 i; i < length; i++) {
            value = value * 10 + uint8(text[start + i]) - 48;
        }
    }
}
