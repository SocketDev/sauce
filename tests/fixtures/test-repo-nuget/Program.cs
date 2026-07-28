using Newtonsoft.Json;
using Serilog;

class Program
{
    static void Main(string[] args)
    {
        Log.Logger = new LoggerConfiguration()
            .WriteTo.Console()
            .CreateLogger();

        var data = new { Name = "test", Version = "1.0.0" };
        Log.Information(JsonConvert.SerializeObject(data));
    }
}
