using System;
using System.Collections.Generic;
using NUnit.Framework;
using IPlay.Cornhole.Tests;

/// <summary>
/// Shows every test in <see cref="CoreSuite"/> in Unity's Test Runner (Window > General > Test Runner > EditMode).
/// The same tests run outside Unity with Tools/CoreTests/run-core-tests.sh.
/// </summary>
public class CoreSuiteTests
{
    public static IEnumerable<TestCaseData> Cases()
    {
        foreach (var t in CoreSuite.All())
            yield return new TestCaseData(t.Value).SetName(t.Key);
    }

    [TestCaseSource(nameof(Cases))]
    public void Run(Action body)
    {
        try { body(); }
        catch (CheckFailed e) { Assert.Fail(e.Message); }
    }
}
