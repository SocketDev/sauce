import com.google.common.collect.ImmutableList;
import org.apache.commons.lang3.StringUtils;

public class App {
    public static void main(String[] args) {
        ImmutableList<String> items = ImmutableList.of("hello", "world");
        System.out.println(StringUtils.join(items, ", "));
    }
}
