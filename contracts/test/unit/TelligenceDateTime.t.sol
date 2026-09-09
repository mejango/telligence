// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TelligenceDateTime} from "../../src/libraries/TelligenceDateTime.sol";

/// @notice Exercises calendar boundaries independently of the authentication signature builder.
contract TelligenceDateTimeTest is Test {
    function testKnownUtcEpochVectors() public pure {
        _assertTimestamp("1970-01-01T00:00:00.000Z", 0);
        _assertTimestamp("2000-02-29T12:34:56.789Z", 951_827_696_789);
        _assertTimestamp("2024-02-29T00:00:00.001Z", 1_709_164_800_001);
        _assertTimestamp("2026-09-09T14:48:27.529Z", 1_788_965_307_529);
        _assertTimestamp("2100-03-01T00:00:00.000Z", 4_107_542_400_000);
        _assertTimestamp("2400-02-29T00:00:00.000Z", 13_574_563_200_000);
        _assertTimestamp("9999-12-31T23:59:59.999Z", 253_402_300_799_999);
    }

    function testRejectsInvalidCalendarFields() public pure {
        _assertInvalid("1969-12-31T23:59:59.999Z");
        _assertInvalid("2026-00-09T14:48:27.529Z");
        _assertInvalid("2026-13-09T14:48:27.529Z");
        _assertInvalid("2026-09-00T14:48:27.529Z");
        _assertInvalid("2026-09-31T14:48:27.529Z");
        _assertInvalid("2026-02-29T14:48:27.529Z");
        _assertInvalid("2100-02-29T14:48:27.529Z");
        _assertInvalid("2026-09-09T24:48:27.529Z");
        _assertInvalid("2026-09-09T14:60:27.529Z");
        _assertInvalid("2026-09-09T14:48:60.529Z");
    }

    function testRejectsNoncanonicalTimestampBytes() public pure {
        _assertInvalid("2026-09-09T14:48:27Z");
        _assertInvalid("2026-09-09T14:48:27.529z");
        _assertInvalid("2026-09-09T14:48:27.529+00:00");
        _assertInvalid("2026-09-09 14:48:27.529Z");
        _assertInvalid("2026-09-09T14:48:27.a29Z");
        _assertInvalid("2026-09-09T14:48:27.529Z\n");
    }

    function testFuzzArbitraryBytesNeverRevert(bytes memory timestamp) public pure {
        TelligenceDateTime.parseMilliseconds(timestamp);
    }

    function _assertInvalid(string memory timestamp) internal pure {
        (bool valid, uint256 milliseconds) = TelligenceDateTime.parseMilliseconds(bytes(timestamp));
        assertFalse(valid);
        assertEq(milliseconds, 0);
    }

    function _assertTimestamp(string memory timestamp, uint256 expected) internal pure {
        (bool valid, uint256 milliseconds) = TelligenceDateTime.parseMilliseconds(bytes(timestamp));
        assertTrue(valid);
        assertEq(milliseconds, expected);
    }
}
